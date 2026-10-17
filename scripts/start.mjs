import { existsSync, cpSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
// Load only server-side configuration. Existing environment variables take precedence.
import { loadHubEnv } from "./lib/environment.mjs";
import { listenOptions } from "./lib/launch.mjs";
import { assertConfig, printConfigError } from "../src/lib/config.mjs";
try {
  loadHubEnv("production");
  Object.assign(process.env, listenOptions(process.argv.slice(2)));
  assertConfig();
} catch (e) {
  printConfigError(e);
  process.exit(1);
}
const root = process.cwd();
const server = join(root, ".next/standalone/server.js");
if (!existsSync(server)) {
  console.error("Production build missing. Run npm run build first.");
  process.exit(1);
}
process.env.DATA_DIR = resolve(process.env.DATA_DIR || ".data");
process.env.HOSTNAME = process.env.HUB_HOST || "127.0.0.1";
process.env.NODE_ENV = "production";
cpSync(join(root, "public"), join(root, ".next/standalone/public"), {
  recursive: true,
});
cpSync(
  join(root, ".next/static"),
  join(root, ".next/standalone/.next/static"),
  { recursive: true },
);
await import(pathToFileURL(server).href);
