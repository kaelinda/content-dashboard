import { rm, mkdir } from "node:fs/promises";

// Playwright starts webServer before globalSetup. Reset the isolated test
// directory in this launcher, before health checks can open PostgreSQL files.
if (
  process.env.DATA_DIR !== ".data-e2e" ||
  process.env.DATABASE_URL ||
  process.env.APP_URL !== "http://127.0.0.1:3100"
) {
  throw new Error("Refusing to reset a non-test workspace");
}
await rm(".data-e2e", { recursive: true, force: true });
await mkdir("test-results", { recursive: true });
await import("../../scripts/start.mjs");
