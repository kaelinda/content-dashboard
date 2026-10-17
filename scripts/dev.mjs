import { createRequire } from "node:module";
import { loadHubEnv } from "./lib/environment.mjs";
import { listenOptions, runForeground } from "./lib/launch.mjs";
import { assertConfig, printConfigError } from "../src/lib/config.mjs";
try {
  loadHubEnv("development");
  Object.assign(process.env, listenOptions(process.argv.slice(2)));
  assertConfig();
  const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
  process.exitCode = await runForeground(process.execPath, [
    next,
    "dev",
    "--hostname",
    process.env.HUB_HOST,
    "--port",
    process.env.PORT,
  ]);
} catch (e) {
  printConfigError(e);
  process.exitCode = 1;
}
