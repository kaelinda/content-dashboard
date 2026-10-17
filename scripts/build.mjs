import { createRequire } from "node:module";
import { loadHubEnv } from "./lib/environment.mjs";
import { runForeground } from "./lib/launch.mjs";
import { assertConfig, printConfigError } from "../src/lib/config.mjs";
try {
  loadHubEnv("production");
  // A reproducible build needs neither owner credentials nor live services.
  assertConfig(process.env, { purpose: "build" });
  const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
  process.exitCode = await runForeground(process.execPath, [
    next,
    "build",
    "--webpack",
    ...process.argv.slice(2),
  ]);
} catch (e) {
  printConfigError(e);
  process.exitCode = 1;
}
