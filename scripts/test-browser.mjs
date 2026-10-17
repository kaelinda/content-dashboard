import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
// Each workflow family gets an independent database and report directory.
// Run every family even if one fails; never turn a failing suite green.
const suites = [
  ["core", "tests/e2e/workspace.spec.ts"],
  ["agents", "tests/e2e/agent-workflow.spec.ts"],
  ["studio", "tests/e2e/studio.spec.ts"],
];
let failed = false;
for (const [name, file] of suites) {
  const result = spawnSync(
    process.execPath,
    [
      resolve("node_modules/@playwright/test/cli.js"),
      "test",
      file,
      "--output=test-results/" + name,
      ...process.argv.slice(2),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        E2E_DATA_DIR: ".data-e2e/" + name,
        PLAYWRIGHT_HTML_OUTPUT_DIR: "playwright-report/" + name,
      },
    },
  );
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
