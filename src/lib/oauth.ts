import { randomUUID } from "node:crypto";
import { database } from "./db.ts";
import {
  issueToken,
  origin,
  oauthClients,
  READ,
  type TokenRow,
  rateLimit,
} from "./auth.ts";
import { digestToken, pkceChallenge, equalSecret } from "./crypto.ts";
import { json, readBytes, errorResponse } from "./http.ts";
import { HubError } from "./domain.ts";
export async function exchange(request: Request): Promise<Response> {
  try {
    await rateLimit("oauth-exchange", 120, 60);
    const params = new URLSearchParams(
      (await readBytes(request, 16384)).toString("utf8"),
    );
    const grant = params.get("grant_type");
    const clientId = params.get("client_id") || "";
    if (!oauthClients().some((c) => c.id === clientId))
      throw new HubError("未注册的客户端");
    if (params.get("resource") !== origin() + "/mcp")
      throw new HubError("OAuth resource 不匹配");
    if (!["authorization_code", "refresh_token"].includes(grant ?? ""))
      return json({ error: "unsupported_grant_type" }, 400);
    const raw =
      params.get(grant === "authorization_code" ? "code" : "refresh_token") ||
      "";
    if (!raw || raw.length > 256) throw new HubError("令牌格式不正确");
    const db = await database();
    const result = await db.transaction(async (tx) => {
      const [record] = await tx.query<TokenRow>(
        "SELECT * FROM tokens WHERE hash=$1 FOR UPDATE",
        [digestToken(raw)],
      );
      if (
        !record ||
        record.kind !== (grant === "authorization_code" ? "code" : "refresh") ||
        record.meta.client_id !== clientId ||
        record.meta.resource !== origin() + "/mcp"
      )
        return { error: "invalid_grant" };
      if (record.revoked_at) {
        if (record.meta.family)
          await tx.query(
            "UPDATE tokens SET revoked_at=now() WHERE meta->>'family'=$1 AND revoked_at IS NULL",
            [record.meta.family],
          );
        return { error: "invalid_grant" };
      }
      if (new Date(record.expires_at).getTime() <= Date.now())
        return { error: "invalid_grant" };
      if (grant === "authorization_code") {
        const verifier = params.get("code_verifier") || "";
        if (
          !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
          !equalSecret(
            pkceChallenge(verifier),
            String(record.meta.code_challenge),
          ) ||
          params.get("redirect_uri") !== record.meta.redirect_uri
        )
          return { error: "invalid_grant" };
      }
      await tx.query("UPDATE tokens SET revoked_at=now() WHERE id=$1", [
        record.id,
      ]);
      const family = record.meta.family || randomUUID();
      const meta = { client_id: clientId, resource: origin() + "/mcp", family };
      const access = await issueToken(
        "access",
        clientId,
        [READ],
        3600,
        meta,
        tx,
      );
      const refresh = await issueToken(
        "refresh",
        clientId,
        [READ],
        30 * 86400,
        meta,
        tx,
      );
      return {
        access_token: access.token,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: refresh.token,
        scope: READ,
      };
    });
    return json(result, "error" in result ? 400 : 200, { Pragma: "no-cache" });
  } catch (e) {
    return errorResponse(e);
  }
}
