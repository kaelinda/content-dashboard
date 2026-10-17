import { spawn } from "node:child_process";
import { ConfigurationError } from "../../src/lib/config.mjs";

export function listenOptions(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = { "--port": "PORT", "--hostname": "HUB_HOST" }[args[i]];
    if (!key || !args[i + 1] || out[key] !== undefined)
      throw new ConfigurationError([
        {
          code: "CLI_ARGUMENT_INVALID",
          field: "arguments",
          level: "error",
          message: "仅支持 --port <端口> 和 --hostname <监听地址>，不能重复。",
        },
      ]);
    out[key] = args[i + 1];
  }
  return out;
}
/** Foreground child, preserving failures and signals; never a detached service. */
export function runForeground(command, args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", env, shell: false });
    const handlers = new Map();
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const fn = () => child.kill(signal);
      handlers.set(signal, fn);
      process.on(signal, fn);
    }
    const cleanup = () => {
      for (const [signal, fn] of handlers) process.off(signal, fn);
    };
    child.once("error", () => {
      console.error(
        "无法启动所需命令；检查 Node、npm 依赖或 Docker 是否已安装。",
      );
      cleanup();
      resolve(1);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      resolve(code ?? (signal === "SIGINT" ? 130 : 143));
    });
  });
}
