import { readFileSync, statSync } from "node:fs";
import { loadHubEnv } from "./lib/environment.mjs";
import { assertConfig, printConfigError } from "../src/lib/config.mjs";
try {
  loadHubEnv(process.env.NODE_ENV || "production");
  assertConfig();
} catch (e) {
  printConfigError(e);
  process.exit(1);
}
const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run restore -- /path/to/backup.json");
  process.exit(1);
}
if (statSync(file).size > 150 * 1024 * 1024)
  throw new Error(
    "Backup too large for JSON restore; use database backup instead.",
  );
const { restoreBackup } = await import("../src/lib/backup.ts");
const { closeDatabase } = await import("../src/lib/db.ts");
try {
  await restoreBackup(JSON.parse(readFileSync(file, "utf8")));
  console.log(
    "Restored content, immutable history and verified blobs. Sessions/secrets were NOT restored.",
  );
} finally {
  await closeDatabase();
}
