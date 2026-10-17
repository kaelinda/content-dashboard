import { loadHubEnv } from "./lib/environment.mjs";
import { runForeground } from "./lib/launch.mjs";
import { assertConfig, printConfigError } from "../src/lib/config.mjs";
try {
  if (process.argv.length > 2) throw new Error("No arguments supported");
  loadHubEnv("production");
  assertConfig(process.env, { compose: true });
  // Known application fields in compose.yaml use this already-parsed environment.
  // This avoids parsing secrets twice with incompatible dotenv expansion rules.
  process.exitCode = await runForeground("docker", [
    "compose",
    "up",
    "--detach",
    "--build",
    "--wait",
    "--wait-timeout",
    "180",
  ]);
} catch (e) {
  printConfigError(e);
  process.exitCode = 1;
}
