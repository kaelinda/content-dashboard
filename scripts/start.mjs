import { existsSync, cpSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
// Load only server-side configuration. Existing environment variables take precedence.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const root = process.cwd();
const server = join(root, ".next/standalone/server.js");
if (!existsSync(server)) {
  console.error("Production build missing. Run npm run build first.");
  process.exit(1);
}
const args = process.argv.slice(2);
if (args.length) {
  if (
    args.length !== 2 ||
    args[0] !== "--port" ||
    !/^\d{2,5}$/.test(args[1]) ||
    Number(args[1]) > 65535
  )
    throw new Error("Usage: npm start [-- --port 3000]");
  process.env.PORT = args[1];
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
