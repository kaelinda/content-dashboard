import { loadHubEnv } from "./lib/environment.mjs";
import { inspectConfig, ConfigurationError } from "../src/lib/config.mjs";
let json = process.argv.includes("--json"),
  mode = "production",
  compose = false;
try {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") continue;
    if (args[i] === "--compose") {
      compose = true;
      continue;
    }
    if (args[i] === "--mode" && args[i + 1]) {
      mode = args[++i];
      continue;
    }
    throw new ConfigurationError([
      {
        level: "error",
        code: "CLI_ARGUMENT_INVALID",
        field: "arguments",
        message:
          "用法：npm run doctor -- [--json] [--compose] [--mode production|development|test]",
      },
    ]);
  }
  const loaded = loadHubEnv(mode);
  const report = inspectConfig(process.env, { compose });
  report.checks.push(...loaded.checks);
  const result = {
    ...report,
    mode,
    sources: loaded.sources,
    networkChecked: false,
    dataModified: false,
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Content Hub 配置检查 · ${mode}${compose ? " · Compose" : ""}`);
    console.log(
      `配置来源：进程环境优先${loaded.sources.length ? " → " + loaded.sources.join(" → ") : "（未读取环境文件）"}`,
    );
    console.log(`数据库模式：${report.database}；文件存储：${report.storage}`);
    for (const check of result.checks)
      console.log(
        `[${check.level.toUpperCase()}] ${check.field}: ${check.message}`,
      );
    console.log(
      report.ok
        ? "配置格式检查通过。未测试网络、云账号、数据库连接或 Agent 账号；未修改业务数据。"
        : "配置未通过。按上方字段修正后重新检查；密钥值未显示。",
    );
  }
  process.exitCode = report.ok ? 0 : 1;
} catch (e) {
  const checks =
    e instanceof ConfigurationError
      ? e.checks
      : [
          {
            level: "error",
            code: "ENV_LOAD_FAILED",
            field: ".env*",
            message: "配置读取失败；检查文件权限与格式。",
          },
        ];
  console.log(
    json
      ? JSON.stringify(
          { ok: false, networkChecked: false, dataModified: false, checks },
          null,
          2,
        )
      : checks.map((c) => `[${c.code}] ${c.field}: ${c.message}`).join("\n"),
  );
  process.exitCode = 1;
}
