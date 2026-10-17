import nextEnv from "@next/env";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { ConfigurationError, configDefaults } from "../../src/lib/config.mjs";

/** Use Next.js's own parser/order/expansion, not a second dotenv implementation. */
export function loadHubEnv(mode = "production", root = process.cwd()) {
  if (!["development", "production", "test"].includes(mode))
    throw new ConfigurationError([
      {
        code: "ENV_MODE_INVALID",
        field: "NODE_ENV",
        level: "error",
        message: "仅支持 development / production / test。",
      },
    ]);
  process.env.NODE_ENV = mode;
  let failed = false;
  const loaded = nextEnv.loadEnvConfig(resolve(root), mode === "development", {
    info() {},
    error() {
      failed = true;
    },
  });
  if (failed)
    throw new ConfigurationError([
      {
        code: "ENV_LOAD_FAILED",
        field: ".env*",
        level: "error",
        message:
          "配置文件读取或变量展开失败；检查语法、循环引用和文件权限。原始错误不会输出。",
      },
    ]);
  Object.assign(process.env, configDefaults(process.env));
  const sources = loaded.loadedEnvFiles.map((file) => file.path);
  const checks = [];
  if (sources.some((name) => name !== ".env.local"))
    checks.push({
      level: "warning",
      code: "ENV_PRECEDENCE",
      field: ".env*",
      message:
        "存在其他环境文件，按 Next.js 标准优先级加载；建议将本项目配置集中于 .env.local。",
    });
  if (process.platform !== "win32") {
    for (const file of sources) {
      const path = resolve(root, file);
      if (existsSync(path) && statSync(path).mode & 0o077)
        checks.push({
          level: "warning",
          code: "ENV_FILE_PERMISSIONS",
          field: file,
          message: "配置文件对其他用户开放；含密钥的文件建议 chmod 600。",
        });
    }
  }
  return { mode, sources, checks };
}
