import { randomBytes, scryptSync } from "node:crypto";
import { writeFileSync, lstatSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { assertConfig, printConfigError } from "../src/lib/config.mjs";

const exists = (file) => {
  try {
    lstatSync(file);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
};
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "首次初始化：npm run setup -- [--docker] [--url https://你的域名] [--password-output /安全路径/初始密码.txt]\n只创建 .env.local，不覆盖已有配置或业务数据。已有安装请运行 npm run doctor。",
    );
    process.exit(0);
  }
  const options = {
    docker: false,
    url: "http://localhost:3000",
    passwordOutput: "",
  };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw new Error();
    seen.add(arg);
    if (arg === "--docker") {
      options.docker = true;
      continue;
    }
    if (["--url", "--password-output"].includes(arg) && args[i + 1]) {
      options[arg === "--url" ? "url" : "passwordOutput"] = args[++i];
    } else throw new Error();
  }
  const envNames = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".env.development.local",
    ".env.production.local",
  ];
  if (envNames.some(exists) || process.env.OWNER_PASSWORD_HASH) {
    console.error(
      "发现已有配置，未覆盖、未轮换任何凭证。请维护现有文件并运行 npm run doctor；不要为再次初始化删除数据。",
    );
    process.exit(1);
  }
  if (
    options.passwordOutput &&
    (envNames.some((f) => resolve(f) === resolve(options.passwordOutput)) ||
      exists(options.passwordOutput))
  ) {
    console.error("密码输出文件已存在或与配置文件重名；未写入任何文件。");
    process.exit(1);
  }
  const password = randomBytes(18).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  const hash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  const env = {
    APP_URL: options.url,
    OWNER_PASSWORD_HASH: hash,
    POSTGRES_PASSWORD: options.docker ? randomBytes(24).toString("hex") : "",
  };
  assertConfig(env, { compose: options.docker });
  const app = new URL(options.url);
  const port = ["localhost", "127.0.0.1", "[::1]"].includes(app.hostname)
    ? app.port || (app.protocol === "https:" ? "443" : "80")
    : "3000";
  const contents = `# 私有配置：不要提交到 GitHub；所有密码/API Key 均为服务端变量。
# 自检：npm run doctor；修改后重启。不要在这里保存 Agent 的 HUB_TOKEN。
APP_URL=${app.origin}
OWNER_PASSWORD_HASH=${hash}
# 留空为单进程 PGlite；Compose 启动会覆盖为容器 PostgreSQL。
DATABASE_URL=
DATA_DIR=.data
STORAGE_DRIVER=local
HUB_HOST=127.0.0.1
PORT=${port}
OAUTH_CLIENTS_JSON=[]
${options.docker ? `# 只在创建全新 Compose 数据库时使用。已有数据库密码不会随环境文件更改。\nPOSTGRES_PASSWORD=${env.POSTGRES_PASSWORD}\n` : "# 对象存储 / OAuth 完整配置项见 .env.example 和 docs/ENVIRONMENT.md。\n"}`;
  let passwordWritten = false;
  try {
    if (options.passwordOutput) {
      writeFileSync(options.passwordOutput, password + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      passwordWritten = true;
    }
    writeFileSync(".env.local", contents, { flag: "wx", mode: 0o600 });
  } catch (e) {
    if (passwordWritten) unlinkSync(options.passwordOutput);
    throw e;
  }
  console.log("已创建 .env.local（权限 0600）；未创建或修改数据库。");
  if (options.passwordOutput)
    console.log(
      "初始工作区密码已写入指定私有文件，未在终端显示。请存入密码管理器。",
    );
  else
    console.log(
      `Owner password (shown only now): ${password}\n请存入密码管理器。配置中仅保存哈希。`,
    );
  console.log(
    options.docker
      ? "下一步：npm run doctor -- --compose，然后 npm run docker:up。"
      : "下一步：npm run doctor，然后 npm run dev。",
  );
} catch (e) {
  printConfigError(e);
  process.exitCode = 1;
}
