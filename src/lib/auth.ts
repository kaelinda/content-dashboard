import { SCOPES } from "./agent/scopes.ts";
import { randomUUID } from "node:crypto";
import { database, type Database } from "./db.ts";
import { HubError } from "./domain.ts";
import { digestToken, randomToken } from "./crypto.ts";
export const READ = "content:read",
  WRITE = "content:write";
export const origin = () => {
  const value = process.env.APP_URL || "http://localhost:3000";
  const u = new URL(value);
  if (u.pathname !== "/" || u.search || u.hash || u.username || u.password)
    throw new HubError("APP_URL 必须是网站根地址", 503);
  if (
    u.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
  )
    throw new HubError("远程部署必须配置 HTTPS 的 APP_URL", 503);
  return u.origin;
};
export type TokenRow = {
  id: string;
  hash: string;
  kind: string;
  label: string;
  scopes: string[];
  meta: Record<string, unknown>;
  expires_at: string;
  revoked_at: string | null;
};
export type Actor = {
  name: string;
  owner: boolean;
  scopes: string[];
  token: TokenRow;
};
export function cookieValue(request: Request): string {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("hub_session="))
      ?.slice("hub_session=".length) ?? ""
  );
}
export function requireOrigin(request: Request) {
  if (request.headers.get("origin") !== origin())
    throw new HubError("请求来源不匹配，请使用 APP_URL 中配置的地址访问", 403);
}
export function sessionCookie(token: string, clear = false): string {
  return `hub_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : 43200}${origin().startsWith("https:") ? "; Secure" : ""}`;
}
export async function issueToken(
  kind: string,
  label: string,
  scopes: string[],
  seconds: number,
  meta: Record<string, unknown> = {},
  tx?: Database,
) {
  const token = randomToken();
  const id = randomUUID();
  await (tx ?? (await database())).query(
    "INSERT INTO tokens(id,hash,kind,label,scopes,meta,expires_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",
    [
      id,
      digestToken(token),
      kind,
      label,
      scopes,
      JSON.stringify(meta),
      new Date(Date.now() + seconds * 1000),
    ],
  );
  return { id, token };
}
export async function authenticate(
  request: Request,
  write = false,
  ownerOnly = false,
  transport: "api" | "mcp" = "api",
  gateway = false,
): Promise<Actor> {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (authorization && !bearer)
    throw new HubError("Bearer 令牌格式不正确", 401);
  const token = bearer || cookieValue(request);
  if (!token || token.length > 256) throw new HubError("请先登录", 401);
  const [record] = await (
    await database()
  ).query<TokenRow>(
    "SELECT * FROM tokens WHERE hash=$1 AND revoked_at IS NULL AND expires_at>now()",
    [digestToken(token)],
  );
  const permitted = bearer
    ? transport === "mcp"
      ? ["api", "access"]
      : ["api"]
    : transport === "api"
      ? ["session"]
      : [];
  if (!record || !permitted.includes(record.kind))
    throw new HubError("登录已过期或令牌无效", 401);
  if (record.kind === "access" && record.meta.resource !== origin() + "/mcp")
    throw new HubError("令牌受众不匹配", 401);
  const owner = record.kind === "session";
  if (
    owner &&
    record.meta.password_fingerprint !==
      digestToken(process.env.OWNER_PASSWORD_HASH || "")
  )
    throw new HubError("密码已轮换，请重新登录", 401);
  if (ownerOnly && !owner)
    throw new HubError("此操作只能由网页登录的所有者执行", 403);
  if (write && owner) requireOrigin(request);
  if (!gateway && record.meta.agent_id)
    throw new HubError("此 Agent 令牌只能使用 /api/v1 或 /mcp", 403);
  if (
    !gateway &&
    !owner &&
    !record.meta.agent_id &&
    (
      await (
        await database()
      ).query("SELECT id FROM projects WHERE id<>'default' LIMIT 1")
    ).length
  )
    throw new HubError(
      "多项目工作区已关闭旧版全库接口，请使用 /api/v1 的默认项目或创建受限 Agent 令牌",
      403,
    );
  const needed = write ? WRITE : READ;
  if (!gateway && !owner && !record.scopes.includes(needed))
    throw new HubError("令牌权限不足", 403);
  return {
    name: owner ? "owner" : `${record.kind}:${record.label}`,
    owner,
    scopes: record.scopes,
    token: record,
  };
}
export async function rateLimit(key: string, max: number, seconds: number) {
  const db = await database();
  const window = Math.floor(Date.now() / (seconds * 1000)) * seconds * 1000;
  const [row] = await db.query<{ attempts: number }>(
    "INSERT INTO rate_limits(key,window_start,attempts) VALUES($1,$2,1) ON CONFLICT(key,window_start) DO UPDATE SET attempts=rate_limits.attempts+1 RETURNING attempts",
    [digestToken(key), window],
  );
  if (row.attempts > max) throw new HubError("请求过于频繁，请稍后重试", 429);
  await db.query("DELETE FROM rate_limits WHERE window_start<$1", [
    Date.now() - 86400000,
  ]);
}
export type OAuthClient = {
  id: string;
  name: string;
  redirect_uris: string[];
  agent_id?: string;
};
export function oauthClients(): OAuthClient[] {
  const raw = JSON.parse(process.env.OAUTH_CLIENTS_JSON || "[]") as unknown;
  if (!Array.isArray(raw)) throw new HubError("OAuth 配置无效", 503);
  return raw.map((c) => {
    if (
      !c ||
      typeof c.id !== "string" ||
      typeof c.name !== "string" ||
      !Array.isArray(c.redirect_uris) ||
      !c.redirect_uris.length
    )
      throw new HubError("OAuth 配置无效", 503);
    for (const uri of c.redirect_uris) {
      const u = new URL(uri);
      if (
        (u.protocol !== "https:" &&
          !(
            u.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(u.hostname)
          )) ||
        u.hash ||
        u.username ||
        u.password
      )
        throw new HubError("OAuth 回调配置无效", 503);
    }
    if (
      c.agent_id !== undefined &&
      (typeof c.agent_id !== "string" ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(c.agent_id))
    )
      throw new HubError("OAuth Agent ID 无效", 503);
    return {
      id: c.id,
      name: c.name,
      redirect_uris: c.redirect_uris,
      ...(c.agent_id ? { agent_id: c.agent_id } : {}),
    };
  });
}
export function validateAuthorization(params: URLSearchParams) {
  const client = oauthClients().find((c) => c.id === params.get("client_id"));
  const redirect = params.get("redirect_uri") || "";
  if (!client || !client.redirect_uris.includes(redirect))
    throw new HubError("未注册的 OAuth 客户端或回调地址");
  if (
    params.get("response_type") !== "code" ||
    params.get("code_challenge_method") !== "S256" ||
    !/^[a-zA-Z0-9_-]{43}$/.test(params.get("code_challenge") || "")
  )
    throw new HubError("必须使用授权码和 PKCE S256");
  if (params.get("resource") !== origin() + "/mcp")
    throw new HubError("OAuth resource 不匹配");
  const scopes = [
    ...new Set(
      (params.get("scope") || (client.agent_id ? "" : READ))
        .split(" ")
        .filter(Boolean),
    ),
  ];
  if (
    !scopes.length ||
    scopes.some((s) =>
      client.agent_id ? !(SCOPES as readonly string[]).includes(s) : s !== READ,
    )
  )
    throw new HubError(
      "请求了未支持的 OAuth 权限；旧客户端仅支持 content:read",
    );
  const state = params.get("state") || "";
  if (state.length > 2048) throw new HubError("state 过长");
  return {
    client,
    scopes,
    redirect,
    challenge: params.get("code_challenge")!,
    state,
    resource: origin() + "/mcp",
  };
}
