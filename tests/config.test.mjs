import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  inspectConfig,
  configDefaults,
  assertConfig,
  ConfigurationError,
} from "../src/lib/config.mjs";

const root = resolve(import.meta.dirname, "..");
const hash = `scrypt:${"a".repeat(32)}:${"b".repeat(128)}`;
const valid = { APP_URL: "http://localhost:3000", OWNER_PASSWORD_HASH: hash };
const codes = (env, options) =>
  inspectConfig({ ...valid, ...env }, options)
    .checks.filter((c) => c.level === "error")
    .map((c) => c.code);
const cleanEnv = (extra = {}) => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  SystemRoot: process.env.SystemRoot,
  NEXT_TELEMETRY_DISABLED: "1",
  ...extra,
});
function temp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "hub-config-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function run(script, cwd, args = [], env = {}) {
  return spawnSync(
    process.execPath,
    [resolve(root, "scripts", script), ...args],
    { cwd, env: cleanEnv(env), encoding: "utf8", timeout: 10000 },
  );
}
function writeEnv(cwd, text, name = ".env.local") {
  writeFileSync(join(cwd, name), text, { mode: 0o600 });
}
const loadScript = pathToFileURL(
  resolve(root, "scripts/lib/environment.mjs"),
).href;
function probe(cwd, mode = "production", env = {}) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {loadHubEnv} from ${JSON.stringify(loadScript)};const r=loadHubEnv(${JSON.stringify(mode)}); console.log(JSON.stringify({sources:r.sources,value:process.env.PROBE,expanded:process.env.EXPANDED}));`,
    ],
    { cwd, env: cleanEnv(env), encoding: "utf8", timeout: 10000 },
  );
}

test("default local configuration is valid and inspection does not mutate it", () => {
  const input = { ...valid };
  const before = JSON.stringify(input);
  assert.equal(inspectConfig(input).ok, true);
  assert.equal(inspectConfig(input).database, "pglite");
  assert.equal(JSON.stringify(input), before);
  assert.equal(configDefaults(input).PORT, "3000");
});
test("build requires no credentials or live services", () =>
  assert.equal(inspectConfig({}, { purpose: "build" }).ok, true));
test("runtime rejects missing owner password", () =>
  assert.equal(inspectConfig({}).ok, false));
test("plaintext password rejected without printing it", () => {
  const result = inspectConfig({
    ...valid,
    OWNER_PASSWORD_HASH: "SYNTHETIC_secret_532",
  });
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes("SYNTHETIC_secret_532"));
});
for (const url of [
  "ftp://localhost",
  "http://remote.example",
  "https://u:p@private.example",
  "https://hub.example/path",
  "https://hub.example/?a=1",
  "https://hub.example/#f",
  "not a URL",
])
  test(`rejects invalid application origin ${url.split(":")[0]}`, () =>
    assert.ok(codes({ APP_URL: url }).includes("APP_URL_INVALID")));
test("valid remote HTTPS and IPv6 loopback accepted", () => {
  assert.deepEqual(codes({ APP_URL: "https://hub.example" }), []);
  assert.deepEqual(codes({ APP_URL: "http://[::1]:3000" }), []);
});
test("external database URL needs PostgreSQL and a database name", () => {
  for (const url of [
    "mysql://u:p@db/test",
    "postgres://db/",
    "bad-connection",
    "postgres://u:p@db:99999/test",
  ])
    assert.ok(codes({ DATABASE_URL: url }).includes("DATABASE_URL_INVALID"));
  assert.deepEqual(
    codes({
      DATABASE_URL: "postgresql://user:p%40ss@db:5432/hub?sslmode=require",
    }),
    [],
  );
});
test("misspelled storage does not fall back to local", () =>
  assert.ok(
    codes({ STORAGE_DRIVER: "S3" }).includes("STORAGE_DRIVER_INVALID"),
  ));
test("public and build directories cannot hold data", () => {
  for (const dir of [".", "public", "public/private", ".next/cache"])
    assert.ok(codes({ DATA_DIR: dir }).includes("DATA_DIR_UNSAFE"));
  assert.deepEqual(codes({ DATA_DIR: ".data" }), []);
});
test("S3 bucket, region and credential pairs are validated", () => {
  const s3 = {
    STORAGE_DRIVER: "s3",
    S3_BUCKET: "private-bucket",
    S3_REGION: "us-east-1",
  };
  assert.deepEqual(codes(s3), []);
  assert.ok(codes({ ...s3, S3_BUCKET: "" }).includes("S3_BUCKET_REQUIRED"));
  assert.ok(codes({ ...s3, S3_REGION: "auto" }).includes("S3_REGION_REQUIRED"));
  assert.ok(
    codes({ ...s3, S3_ACCESS_KEY_ID: "synthetic" }).includes(
      "S3_CREDENTIAL_PAIR",
    ),
  );
  assert.deepEqual(
    codes({
      ...s3,
      S3_ACCESS_KEY_ID: "synthetic",
      S3_SECRET_ACCESS_KEY: "synthetic",
      S3_SESSION_TOKEN: "temporary",
    }),
    [],
  );
  assert.ok(
    codes({ ...s3, S3_SESSION_TOKEN: "temporary" }).includes("S3_SESSION_PAIR"),
  );
});
test("custom S3 endpoint allows auto region and rejects plaintext remote URL", () => {
  const s3 = {
    STORAGE_DRIVER: "s3",
    S3_BUCKET: "private",
    S3_ENDPOINT: "https://s3.example",
  };
  assert.deepEqual(codes(s3), []);
  assert.ok(
    codes({ ...s3, S3_ENDPOINT: "http://s3.example" }).includes(
      "S3_ENDPOINT_INVALID",
    ),
  );
});
test("unused S3 placeholders do not block local storage", () =>
  assert.deepEqual(
    codes({ S3_REGION: "auto", S3_ACCESS_KEY_ID: "unused" }),
    [],
  ));
test("OAuth validates duplicate IDs, missing fields, wildcards and malformed JSON", () => {
  const c = {
    id: "reader",
    name: "Reader",
    redirect_uris: ["https://client.example/callback"],
  };
  assert.deepEqual(codes({ OAUTH_CLIENTS_JSON: JSON.stringify([c]) }), []);
  for (const raw of [
    "{",
    "null",
    "{}",
    JSON.stringify([c, c]),
    JSON.stringify([{ ...c, redirect_uris: ["https://client.example/*"] }]),
    JSON.stringify([
      { ...c, redirect_uris: ["https://u:secret@client.example/cb"] },
    ]),
    JSON.stringify([{ ...c, agent_id: "../invalid" }]),
  ])
    assert.ok(
      codes({ OAUTH_CLIENTS_JSON: raw }).includes("OAUTH_CONFIG_INVALID"),
    );
});
test("port and host reject empty-format, fractional, scheme and out-of-range inputs", () => {
  for (const port of ["0", "65536", "abc", "3.1", "3000x"])
    assert.ok(codes({ PORT: port }).includes("PORT_INVALID"));
  assert.ok(
    codes({ HUB_HOST: "https://localhost" }).includes("HUB_HOST_INVALID"),
  );
  assert.deepEqual(codes({ HUB_HOST: "::" }), []);
});
test("Compose validates separate database password without rotating it", () => {
  assert.ok(
    codes({}, { compose: true }).includes("POSTGRES_PASSWORD_REQUIRED"),
  );
  assert.deepEqual(
    codes(
      { POSTGRES_PASSWORD: "a".repeat(48), DATABASE_URL: "ignored-in-compose" },
      { compose: true },
    ),
    [],
  );
});
test("private credentials may not be marked public", () => {
  assert.ok(
    codes({ NEXT_PUBLIC_DATABASE_URL: "synthetic-private" }).includes(
      "PUBLIC_SECRET_FORBIDDEN",
    ),
  );
  assert.deepEqual(codes({ NEXT_PUBLIC_ANALYTICS_ID: "public-id" }), []);
});
test("configuration errors expose only safe diagnostics", () => {
  assert.throws(
    () =>
      assertConfig({
        ...valid,
        APP_URL: "https://u:SYNTHETIC_SECRET@remote.example/path",
      }),
    (e) =>
      e instanceof ConfigurationError &&
      !JSON.stringify(e).includes("SYNTHETIC_SECRET"),
  );
});
test("Next production priority and shell precedence are preserved", () =>
  temp((dir) => {
    for (const [name, value] of [
      [".env", "base"],
      [".env.production", "production"],
      [".env.local", "local"],
      [".env.production.local", "production-local"],
    ])
      writeEnv(dir, `PROBE=${value}\n`, name);
    const p = probe(dir);
    assert.equal(p.status, 0, p.stderr);
    const data = JSON.parse(p.stdout);
    assert.equal(data.value, "production-local");
    assert.deepEqual(data.sources, [
      ".env.production.local",
      ".env.local",
      ".env.production",
      ".env",
    ]);
    const shell = probe(dir, "production", { PROBE: "shell" });
    assert.equal(JSON.parse(shell.stdout).value, "shell");
  }));
test("development mode uses its own overrides", () =>
  temp((dir) => {
    writeEnv(dir, "PROBE=local\n");
    writeEnv(dir, "PROBE=dev\n", ".env.development.local");
    assert.equal(JSON.parse(probe(dir, "development").stdout).value, "dev");
  }));
test("test mode does not load private .env.local", () =>
  temp((dir) => {
    writeEnv(dir, "PROBE=private\n");
    writeEnv(dir, "PROBE=test\n", ".env.test");
    const data = JSON.parse(probe(dir, "test").stdout);
    assert.equal(data.value, "test");
    assert.ok(!data.sources.includes(".env.local"));
  }));
test("dollar expansion and escaped literal dollars use Next's parser", () =>
  temp((dir) => {
    writeEnv(dir, 'PROBE=base\nEXPANDED="${PROBE}-literal\\$dollar"\n');
    const p = probe(dir);
    assert.equal(p.status, 0, p.stderr);
    assert.equal(JSON.parse(p.stdout).expanded, "base-literal$dollar");
  }));
test("environment parse/expansion failures are sanitized", () =>
  temp((dir) => {
    writeEnv(dir, "SYNTHETIC_SECRET=$SYNTHETIC_SECRET\n");
    const p = run("doctor.mjs", dir, ["--json"]);
    assert.equal(p.status, 1);
    const data = JSON.parse(p.stdout);
    assert.equal(data.ok, false);
    assert.ok(!p.stdout.includes("SYNTHETIC_SECRET"));
    assert.equal(p.stderr, "");
  }));
test("setup produces private env and password file without exposing password", () =>
  temp((dir) => {
    const p = run("setup.mjs", dir, ["--password-output", "owner.txt"]);
    assert.equal(p.status, 0, p.stderr);
    const env = readFileSync(join(dir, ".env.local"), "utf8"),
      password = readFileSync(join(dir, "owner.txt"), "utf8").trim();
    assert.ok(password.length >= 24);
    assert.ok(!env.includes(password));
    assert.ok(!p.stdout.includes(password));
    assert.match(env, /OWNER_PASSWORD_HASH=scrypt:[a-f0-9]{32}:[a-f0-9]{128}/);
    if (process.platform !== "win32") {
      assert.equal(statSync(join(dir, ".env.local")).mode & 0o777, 0o600);
      assert.equal(statSync(join(dir, "owner.txt")).mode & 0o777, 0o600);
    }
    assert.deepEqual(readdirSync(dir).sort(), [".env.local", "owner.txt"]);
  }));
test("setup Docker creates a new random DB credential and doctor accepts it", () =>
  temp((dir) => {
    const p = run("setup.mjs", dir, [
      "--docker",
      "--url",
      "https://hub.example",
      "--password-output",
      "owner.txt",
    ]);
    assert.equal(p.status, 0, p.stderr);
    const env = readFileSync(join(dir, ".env.local"), "utf8");
    assert.match(env, /POSTGRES_PASSWORD=[a-f0-9]{48}/);
    const doctor = run("doctor.mjs", dir, ["--compose", "--json"]);
    assert.equal(doctor.status, 0, doctor.stderr);
    const data = JSON.parse(doctor.stdout);
    assert.equal(data.ok, true);
    assert.equal(data.database, "postgres");
    assert.equal(data.networkChecked, false);
  }));
test("setup refuses existing local env without altering it", () =>
  temp((dir) => {
    writeEnv(dir, "KEEP=original\n");
    const p = run("setup.mjs", dir, ["--docker"]);
    assert.equal(p.status, 1);
    assert.equal(
      readFileSync(join(dir, ".env.local"), "utf8"),
      "KEEP=original\n",
    );
  }));
test("setup refuses a pre-existing .env or process credential", () =>
  temp((dir) => {
    writeEnv(dir, "KEEP=original\n", ".env");
    assert.equal(run("setup.mjs", dir).status, 1);
    rmSync(join(dir, ".env"));
    assert.equal(
      run("setup.mjs", dir, [], { OWNER_PASSWORD_HASH: hash }).status,
      1,
    );
    assert.deepEqual(readdirSync(dir), []);
  }));
test("setup refuses a broken symlink instead of following it", () =>
  temp((dir) => {
    if (process.platform === "win32") return;
    symlinkSync("absent-target", join(dir, ".env.local"));
    assert.equal(run("setup.mjs", dir).status, 1);
    assert.deepEqual(readdirSync(dir), [".env.local"]);
  }));
test("setup invalid URL or options create no files", () =>
  temp((dir) => {
    for (const args of [
      ["--url", "http://remote.example"],
      ["--password", "DO_NOT_ECHO"],
    ]) {
      const p = run("setup.mjs", dir, args);
      assert.equal(p.status, 1);
      assert.ok(!(p.stdout + p.stderr).includes("DO_NOT_ECHO"));
      assert.deepEqual(readdirSync(dir), []);
    }
  }));
test("setup refuses existing password output without overwriting it", () =>
  temp((dir) => {
    writeFileSync(join(dir, "owner.txt"), "keep");
    assert.equal(
      run("setup.mjs", dir, ["--password-output", "owner.txt"]).status,
      1,
    );
    assert.equal(readFileSync(join(dir, "owner.txt"), "utf8"), "keep");
  }));
test("doctor JSON is read-only, sanitized and exits nonzero for invalid config", () =>
  temp((dir) => {
    const original = `APP_URL=https://u:SYNTHETIC_PRIVATE@host.example/path\nOWNER_PASSWORD_HASH=SYNTHETIC_PRIVATE\n`;
    writeEnv(dir, original);
    const p = run("doctor.mjs", dir, ["--json"]);
    assert.equal(p.status, 1);
    const data = JSON.parse(p.stdout);
    assert.equal(data.dataModified, false);
    assert.ok(!p.stdout.includes("SYNTHETIC_PRIVATE"));
    assert.equal(p.stderr, "");
    assert.equal(readFileSync(join(dir, ".env.local"), "utf8"), original);
    assert.deepEqual(readdirSync(dir), [".env.local"]);
  }));
test("valid environment-only deployment needs no env file", () =>
  temp((dir) => {
    const p = run("doctor.mjs", dir, ["--json"], valid);
    assert.equal(p.status, 0, p.stderr);
    assert.deepEqual(JSON.parse(p.stdout).sources, []);
    assert.deepEqual(readdirSync(dir), []);
  }));
test("start, dev and Docker entry reject config before opening services", () =>
  temp((dir) => {
    for (const script of ["start.mjs", "dev.mjs", "docker-entry.mjs"]) {
      const p = run(script, dir, [], { OWNER_PASSWORD_HASH: "DO_NOT_ECHO" });
      assert.equal(p.status, 1);
      assert.match(p.stderr, /OWNER_HASH_INVALID/);
      assert.ok(!p.stderr.includes("DO_NOT_ECHO"));
    }
    assert.deepEqual(readdirSync(dir), []);
  }));
test("native launch arguments reject duplicates rather than silently picking one", () =>
  temp((dir) => {
    const p = run(
      "start.mjs",
      dir,
      ["--port", "3000", "--port", "4000"],
      valid,
    );
    assert.equal(p.status, 1);
    assert.match(p.stderr, /CLI_ARGUMENT_INVALID/);
  }));
test("migrate and restore refuse invalid configuration before database import", () =>
  temp((dir) => {
    for (const script of ["migrate.ts", "restore.ts"]) {
      const p = spawnSync(
        process.execPath,
        [
          resolve(root, "node_modules/tsx/dist/cli.mjs"),
          resolve(root, "scripts", script),
        ],
        {
          cwd: dir,
          env: cleanEnv({ OWNER_PASSWORD_HASH: "DO_NOT_ECHO" }),
          encoding: "utf8",
          timeout: 10000,
        },
      );
      assert.equal(p.status, 1, p.stderr);
      assert.match(p.stderr, /OWNER_HASH_INVALID/);
      assert.ok(!p.stderr.includes("DO_NOT_ECHO"));
    }
    assert.deepEqual(readdirSync(dir), []);
  }));
