import { isIP } from "node:net";
import { resolve, relative, isAbsolute } from "node:path";

/** Configuration diagnostics never include values, URLs, credentials or parser errors. */
export class ConfigurationError extends Error {
  constructor(checks) {
    super("Content Hub configuration is invalid. Run npm run doctor.");
    this.name = "ConfigurationError";
    this.checks = checks;
  }
}
const loopback = (hostname) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
const bounded = (value, max = 16384) =>
  typeof value === "string" &&
  value.length <= max &&
  !/[\u0000\r\n]/.test(value);
const inside = (parent, child) => {
  const p = relative(parent, child);
  return p === "" || (!p.startsWith("..") && !isAbsolute(p));
};
function webUrl(value, rootOnly = false) {
  if (!bounded(value, 4096)) return false;
  try {
    const u = new URL(value);
    return (
      (u.protocol === "https:" ||
        (u.protocol === "http:" && loopback(u.hostname))) &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !value.includes("*") &&
      (!rootOnly || (u.pathname === "/" && !u.search))
    );
  } catch {
    return false;
  }
}

/** Same defaults for Node launchers and Compose's explicitly injected variables. */
export function configDefaults(env = process.env) {
  return {
    APP_URL: env.APP_URL || "http://localhost:3000",
    OWNER_PASSWORD_HASH: env.OWNER_PASSWORD_HASH || "",
    DATABASE_URL: env.DATABASE_URL || "",
    DATA_DIR: env.DATA_DIR || ".data",
    STORAGE_DRIVER: env.STORAGE_DRIVER || "local",
    S3_ENDPOINT: env.S3_ENDPOINT || "",
    S3_REGION: env.S3_REGION || "auto",
    S3_BUCKET: env.S3_BUCKET || "",
    S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID || "",
    S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY || "",
    S3_SESSION_TOKEN: env.S3_SESSION_TOKEN || "",
    OAUTH_CLIENTS_JSON: env.OAUTH_CLIENTS_JSON || "[]",
    HUB_HOST: env.HUB_HOST || "127.0.0.1",
    PORT: env.PORT || "3000",
  };
}

/** Pure validation: no network, database initialization, file writes or environment mutation. */
export function inspectConfig(env = process.env, options = {}) {
  const {
    purpose = "runtime",
    root = process.cwd(),
    compose = false,
  } = options;
  const c = configDefaults(env);
  const checks = [];
  const add = (level, code, field, message) =>
    checks.push({ level, code, field, message });
  if (!webUrl(c.APP_URL, true))
    add(
      "error",
      "APP_URL_INVALID",
      "APP_URL",
      "必须是站点根地址：远程使用 HTTPS，本机可用 HTTP；不含凭证、路径、查询或片段。",
    );
  else {
    add(
      "ok",
      "APP_URL_VALID",
      "APP_URL",
      "站点地址格式正确；格式正确不代表域名或证书已可用。",
    );
    if (loopback(new URL(c.APP_URL).hostname))
      add(
        "warning",
        "LOCAL_ORIGIN",
        "APP_URL",
        "当前为本机地址，远程 Agent 不能直接访问；远程接入需可达 HTTPS 地址。",
      );
  }
  if (!c.OWNER_PASSWORD_HASH && purpose !== "build")
    add(
      "error",
      "OWNER_PASSWORD_REQUIRED",
      "OWNER_PASSWORD_HASH",
      "尚未初始化。首次运行 npm run setup；已有安装应恢复原配置，不要删除数据。",
    );
  else if (
    c.OWNER_PASSWORD_HASH &&
    !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(c.OWNER_PASSWORD_HASH)
  )
    add(
      "error",
      "OWNER_HASH_INVALID",
      "OWNER_PASSWORD_HASH",
      "必须是 setup 生成的 scrypt 哈希，不能填写明文密码。",
    );
  else if (c.OWNER_PASSWORD_HASH)
    add(
      "ok",
      "OWNER_HASH_VALID",
      "OWNER_PASSWORD_HASH",
      "密码哈希格式正确，未输出哈希或密码。",
    );
  if (c.DATABASE_URL && !compose) {
    let valid = false;
    try {
      const u = new URL(c.DATABASE_URL);
      valid =
        bounded(c.DATABASE_URL) &&
        ["postgres:", "postgresql:"].includes(u.protocol) &&
        !!u.hostname &&
        u.pathname.length > 1 &&
        !u.hash;
    } catch {
      /* sanitized below */
    }
    if (!valid)
      add(
        "error",
        "DATABASE_URL_INVALID",
        "DATABASE_URL",
        "填写有效 PostgreSQL 连接地址（含数据库名）；密码特殊字符需 URL 编码。",
      );
    else
      add(
        "ok",
        "DATABASE_CONFIGURED",
        "DATABASE_URL",
        "已选择外部 PostgreSQL；此检查不连接数据库。",
      );
  } else if (!compose) {
    add(
      "warning",
      "PGLITE_SINGLE_PROCESS",
      "DATABASE_URL",
      "留空时使用本地 PGlite。迁移、开发、生产服务不可同时打开同一目录；多实例用 PostgreSQL。",
    );
  }
  if (!bounded(c.DATA_DIR, 4096))
    add(
      "error",
      "DATA_DIR_INVALID",
      "DATA_DIR",
      "数据目录必须是有效的单行路径。",
    );
  else {
    const target = resolve(root, c.DATA_DIR);
    if (
      target === resolve(root) ||
      inside(resolve(root, "public"), target) ||
      inside(resolve(root, ".next"), target)
    )
      add(
        "error",
        "DATA_DIR_UNSAFE",
        "DATA_DIR",
        "数据目录不可使用项目根目录、public 或 .next；建议保留 .data 或独立私有目录。",
      );
  }
  if (!["local", "s3"].includes(c.STORAGE_DRIVER))
    add(
      "error",
      "STORAGE_DRIVER_INVALID",
      "STORAGE_DRIVER",
      "仅支持 local 或 s3；不会将拼写错误默默当作本地存储。",
    );
  if (c.STORAGE_DRIVER === "s3") {
    if (
      !bounded(c.S3_BUCKET, 255) ||
      !c.S3_BUCKET.trim() ||
      /[\s/\\]/.test(c.S3_BUCKET)
    )
      add(
        "error",
        "S3_BUCKET_REQUIRED",
        "S3_BUCKET",
        "s3 模式必须填写私有 Bucket 名称，不能填写 URL 或路径。",
      );
    if (c.S3_ENDPOINT && !webUrl(c.S3_ENDPOINT))
      add(
        "error",
        "S3_ENDPOINT_INVALID",
        "S3_ENDPOINT",
        "自定义 S3 endpoint 需 HTTPS（本机测试可 HTTP），不得含凭证或片段。",
      );
    if (
      !bounded(c.S3_REGION, 100) ||
      (!c.S3_ENDPOINT && c.S3_REGION === "auto")
    )
      add(
        "error",
        "S3_REGION_REQUIRED",
        "S3_REGION",
        "AWS S3 未设置自定义 endpoint 时，需填写真实 region，不能使用 auto。",
      );
    if (!!c.S3_ACCESS_KEY_ID !== !!c.S3_SECRET_ACCESS_KEY)
      add(
        "error",
        "S3_CREDENTIAL_PAIR",
        "S3_ACCESS_KEY_ID",
        "S3_ACCESS_KEY_ID 与 S3_SECRET_ACCESS_KEY 必须成对填写，或全部留空使用运行环境凭证链。",
      );
    if (c.S3_SESSION_TOKEN && (!c.S3_ACCESS_KEY_ID || !c.S3_SECRET_ACCESS_KEY))
      add(
        "error",
        "S3_SESSION_PAIR",
        "S3_SESSION_TOKEN",
        "临时会话令牌必须配合完整 S3 Access Key / Secret Key。",
      );
    for (const key of [
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_SESSION_TOKEN",
    ])
      if (!bounded(c[key]))
        add(
          "error",
          "S3_CREDENTIAL_INVALID",
          key,
          "凭证必须是有效单行值；内容不会显示在诊断中。",
        );
    add(
      "warning",
      "S3_NOT_PROBED",
      "STORAGE_DRIVER",
      "只检查配置，不检测云账号、读写权限或连接；切换存储不会自动迁移已有文件。",
    );
  }
  let clients = [];
  try {
    if (c.OAUTH_CLIENTS_JSON.length > 131072) throw new Error();
    clients = JSON.parse(c.OAUTH_CLIENTS_JSON);
    if (!Array.isArray(clients) || clients.length > 100) throw new Error();
    const ids = new Set();
    for (const client of clients) {
      if (
        !client ||
        typeof client !== "object" ||
        Array.isArray(client) ||
        !bounded(client.id, 200) ||
        !client.id.trim() ||
        ids.has(client.id) ||
        !bounded(client.name, 200) ||
        !client.name.trim() ||
        !Array.isArray(client.redirect_uris) ||
        !client.redirect_uris.length ||
        client.redirect_uris.some((u) => !webUrl(u)) ||
        (client.agent_id !== undefined &&
          (typeof client.agent_id !== "string" ||
            !/^[A-Za-z0-9_-]{1,64}$/.test(client.agent_id)))
      )
        throw new Error();
      ids.add(client.id);
    }
    add(
      "ok",
      "OAUTH_FORMAT_VALID",
      "OAUTH_CLIENTS_JSON",
      "OAuth 配置结构正确；不验证 Agent 是否存在，也不自动批准或授予写权限。",
    );
  } catch {
    clients = [];
    add(
      "error",
      "OAUTH_CONFIG_INVALID",
      "OAUTH_CLIENTS_JSON",
      "须为 JSON 数组：唯一 id、name、精确 redirect_uris；可选 agent_id。无需 OAuth 时填 []。",
    );
  }
  if (!/^\d{1,5}$/.test(c.PORT) || Number(c.PORT) < 1 || Number(c.PORT) > 65535)
    add("error", "PORT_INVALID", "PORT", "端口必须为 1–65535 的整数。");
  if (
    !bounded(c.HUB_HOST, 253) ||
    !(
      isIP(c.HUB_HOST) ||
      /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(
        c.HUB_HOST,
      )
    )
  )
    add(
      "error",
      "HUB_HOST_INVALID",
      "HUB_HOST",
      "监听地址填写主机名或 IP，不含协议、端口或路径。",
    );
  if (compose) {
    if (!/^[a-fA-F0-9]{32,128}$/.test(env.POSTGRES_PASSWORD || ""))
      add(
        "error",
        "POSTGRES_PASSWORD_REQUIRED",
        "POSTGRES_PASSWORD",
        "Compose 需要 32–128 位十六进制随机数据库密码；首次可用 npm run setup -- --docker。已有数据库不得随意更改此值。",
      );
    else
      add(
        "ok",
        "COMPOSE_DATABASE_CONFIGURED",
        "POSTGRES_PASSWORD",
        "Compose 将连接容器内 PostgreSQL，覆盖本机 DATABASE_URL / DATA_DIR；不会修改现有数据库密码。",
      );
  }
  if (
    Object.keys(env).some((key) =>
      /^NEXT_PUBLIC_.*(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY|ACCESS_KEY|DATABASE_URL|OAUTH_CLIENTS_JSON)/.test(
        key,
      ),
    )
  )
    add(
      "error",
      "PUBLIC_SECRET_FORBIDDEN",
      "NEXT_PUBLIC_*",
      "发现可能公开的服务端密钥变量。去掉 NEXT_PUBLIC_ 前缀；密钥不得进入浏览器构建。",
    );
  return {
    ok: !checks.some((c) => c.level === "error"),
    purpose,
    database: compose || c.DATABASE_URL ? "postgres" : "pglite",
    storage: ["local", "s3"].includes(c.STORAGE_DRIVER)
      ? c.STORAGE_DRIVER
      : "invalid",
    oauthClients: clients.length,
    checks,
  };
}
export function assertConfig(env = process.env, options = {}) {
  const report = inspectConfig(env, options);
  if (!report.ok)
    throw new ConfigurationError(
      report.checks.filter((c) => c.level === "error"),
    );
  return report;
}
export function printConfigError(error) {
  // Never print raw caught exceptions: URLs/parser messages can embed secrets.
  console.error("配置检查未通过；未启动服务或访问业务数据。");
  if (error instanceof ConfigurationError)
    for (const c of error.checks)
      console.error(`[${c.code}] ${c.field}: ${c.message}`);
  else
    console.error("无法读取配置。检查文件权限和格式，再运行 npm run doctor。");
}
