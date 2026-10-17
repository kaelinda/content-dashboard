import { defineConfig } from "@playwright/test";
import { scryptSync } from "node:crypto";
const password = "Browser-acceptance-synthetic-password";
const salt = "12345678901234567890123456789012";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 1512, height: 1100 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: "node --experimental-strip-types tests/e2e/setup.ts --port 3100",
    url: "http://127.0.0.1:3100/api/health",
    timeout: 120000,
    reuseExistingServer: false,
    env: {
      APP_URL: "http://127.0.0.1:3100",
      OWNER_PASSWORD_HASH: `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
      DATA_DIR: process.env.E2E_DATA_DIR || ".data-e2e",
      DATABASE_URL: "",
      STORAGE_DRIVER: "local",
      OAUTH_CLIENTS_JSON: "[]",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
