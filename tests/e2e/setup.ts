import { rm, mkdir } from "node:fs/promises";

// Playwright starts webServer before globalSetup. Reset the isolated test
// directory in this launcher, before health checks can open PostgreSQL files.
if (
  ![
    ".data-e2e",
    ".data-e2e/core",
    ".data-e2e/agents",
    ".data-e2e/studio",
    ".data-e2e/operations",
  ].includes(process.env.DATA_DIR || "") ||
  process.env.DATABASE_URL ||
  process.env.APP_URL !== "http://127.0.0.1:3100"
) {
  throw new Error("Refusing to reset a non-test workspace");
}
await rm(process.env.DATA_DIR!, { recursive: true, force: true });
await mkdir("test-results", { recursive: true });
await import("../../scripts/start.mjs");
