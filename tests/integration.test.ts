import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { database, closeDatabase } from "../src/lib/db.ts";
import {
  saveContent,
  getContent,
  saveSource,
  renderArtifact,
  savePublication,
  saveAsset,
  listContents,
} from "../src/lib/repository.ts";
import { exportBackup, restoreBackup } from "../src/lib/backup.ts";
import { getBlob, putBlob, sha256 } from "../src/lib/storage.ts";
import {
  hashPassword,
  verifyPassword,
  pkceChallenge,
  digestToken,
} from "../src/lib/crypto.ts";
import {
  authenticate,
  issueToken,
  READ,
  WRITE,
  validateAuthorization,
} from "../src/lib/auth.ts";
import { handle } from "../src/lib/api.ts";
import { exchange } from "../src/lib/oauth.ts";
import { POST as mcpPost } from "../src/app/mcp/route.ts";
import { extractHtml, safeFetch } from "../src/lib/ingest.ts";
import type { Source, ContentDetail, Artifact } from "../src/lib/domain.ts";

// Isolated temporary data only: never touches the owner's database or tokens.
let root: string,
  restoredRoot: string,
  source: Source,
  content: ContentDetail,
  artifact: Artifact,
  cookie: string,
  reader: string,
  writer: string;
let primaryDatabase = "",
  restoreDatabase = "",
  testSchemas: string[] = [];
let backup: Awaited<ReturnType<typeof exportBackup>>;
const base = "http://localhost:3000";
const password = "Synthetic-test-password-only-2026";
function request(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(base + "/api/" + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method !== "GET"
        ? { Origin: base, "Content-Type": "application/json" }
        : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const input = (title = "Content Hub 集成测试") => ({
  title,
  status: "draft",
  tags: ["测试"],
  source_ids: [source.id],
  blocks: [
    {
      id: randomUUID(),
      type: "paragraph",
      text: "有来源的真实持久化正文。<script>bad()</script>",
      source_refs: [source.id],
    },
  ],
});
before(async () => {
  root = await mkdtemp(join(tmpdir(), "content-hub-test-"));
  restoredRoot = await mkdtemp(join(tmpdir(), "content-hub-restore-"));
  if (process.env.TEST_DATABASE_URL) {
    const { Client } = await import("pg");
    const admin = new Client({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    await admin.connect();
    testSchemas = [
      "hub_test_" + randomUUID().replaceAll("-", ""),
      "hub_restore_" + randomUUID().replaceAll("-", ""),
    ];
    try {
      for (const schema of testSchemas)
        await admin.query(`CREATE SCHEMA ${schema}`);
    } finally {
      await admin.end();
    }
    const uri = (schema: string) => {
      const u = new URL(process.env.TEST_DATABASE_URL!);
      u.searchParams.set("options", "-c search_path=" + schema);
      return u.href;
    };
    primaryDatabase = uri(testSchemas[0]);
    restoreDatabase = uri(testSchemas[1]);
  }
  process.env.DATA_DIR = root;
  process.env.DATABASE_URL = primaryDatabase;
  process.env.STORAGE_DRIVER = "local";
  process.env.APP_URL = base;
  process.env.OWNER_PASSWORD_HASH = hashPassword(password);
  process.env.OAUTH_CLIENTS_JSON = JSON.stringify([
    {
      id: "test-client",
      name: "Test client",
      redirect_uris: ["http://localhost:9000/callback"],
    },
  ]);
});
after(async () => {
  await closeDatabase();
  if (testSchemas.length) {
    const { Client } = await import("pg");
    const admin = new Client({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    await admin.connect();
    try {
      for (const schema of testSchemas)
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  }
  await rm(root, { recursive: true, force: true });
  await rm(restoredRoot, { recursive: true, force: true });
});

test("initial migration starts a real PostgreSQL engine", async () => {
  const db = await database();
  const rows = await db.query<{ version: string }>("SELECT version()");
  assert.match(rows[0].version, /PostgreSQL/);
});
test("passwords are salted and verified without plaintext storage", () => {
  const hash = hashPassword(password);
  assert.notEqual(hash, process.env.OWNER_PASSWORD_HASH);
  assert(verifyPassword(password, hash));
  assert(!verifyPassword("wrong", hash));
  assert(!verifyPassword(password, "malformed"));
});
test("unauthenticated content cannot be read or mutated", async () => {
  for (const method of ["GET", "POST", "DELETE"])
    assert.equal(
      (
        await handle(
          request("contents", method, method === "POST" ? {} : undefined),
        )
      ).status,
      401,
    );
});
test("owner login sets a private session cookie and rejects bad origins", async () => {
  assert.equal(
    (
      await handle(
        request(
          "auth/login",
          "POST",
          { password },
          { Origin: "https://attacker.invalid" },
        ),
      )
    ).status,
    403,
  );
  assert.equal(
    (await handle(request("auth/login", "POST", { password: "wrong" }))).status,
    401,
  );
  const res = await handle(request("auth/login", "POST", { password }));
  assert.equal(res.status, 200);
  const set = res.headers.get("set-cookie")!;
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
  cookie = set.split(";")[0];
});
test("original bytes deduplicate while alternate locations are preserved", async () => {
  source = await saveSource(Buffer.from("原始证据\n第二段。"), {
    title: "证据",
    url: "https://example.com/a",
    markdown: "原始证据\n第二段。",
    mime: "text/markdown",
  });
  const other = await saveSource(Buffer.from("原始证据\n第二段。"), {
    title: "另一标题",
    url: "https://example.com/b",
    markdown: "可重抽文本",
    mime: "text/markdown",
  });
  assert.equal(source.id, other.id);
  assert.equal((await getBlob(source.sha256)).toString(), "原始证据\n第二段。");
  assert.equal(
    (await (await database()).query("SELECT * FROM source_locations")).length,
    2,
  );
});
test("saving content commits a version and its evidence in one transaction", async () => {
  content = await saveContent(input());
  assert.equal(content.version, 1);
  assert.deepEqual(content.source_ids, [source.id]);
  assert.equal(content.blocks[0].source_refs[0], source.id);
});
test("referencing a missing source rolls back the entire transaction", async () => {
  const v = input("Should not be inserted");
  v.source_ids = [randomUUID()];
  v.blocks[0].source_refs = v.source_ids;
  await assert.rejects(saveContent(v), /来源不存在/);
  assert.equal((await listContents("Should not be inserted")).length, 0);
});
test("artifact generation is deterministic, escaped and deduplicated", async () => {
  artifact = await renderArtifact(content.id, 1, "html", "web");
  const second = await renderArtifact(content.id, 1, "html", "web");
  assert.equal(artifact.id, second.id);
  const bytes = await getBlob(artifact.sha256);
  assert.equal(sha256(bytes), artifact.sha256);
  assert(!bytes.toString().includes("<script>bad()"));
  assert(bytes.toString().includes("&lt;script&gt;"));
});
test("updates preserve old titles, blocks and artifact bytes", async () => {
  const previousBytes = await getBlob(artifact.sha256);
  content = await saveContent(
    { ...input("新的标题"), expected_version: 1 },
    content.id,
  );
  assert.equal(content.version, 2);
  const old = await getContent(content.id, 1);
  assert.equal(old.title, "Content Hub 集成测试");
  assert.equal(old.current_version, 2);
  assert.deepEqual(await getBlob(artifact.sha256), previousBytes);
});
test("stale writes fail with 409 rather than silently overwriting", async () => {
  await assert.rejects(
    saveContent({ ...input("旧窗口"), expected_version: 1 }, content.id),
    (e: unknown) => (e as { status: number }).status === 409,
  );
  assert.equal((await getContent(content.id)).current_version, 2);
});
test("concurrent writers cannot produce duplicate versions", async () => {
  const result = await Promise.allSettled([
    saveContent({ ...input("并发 A"), expected_version: 2 }, content.id),
    saveContent({ ...input("并发 B"), expected_version: 2 }, content.id),
  ]);
  assert.equal(result.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(result.filter((x) => x.status === "rejected").length, 1);
  content = await getContent(content.id);
  assert.equal(content.version, 3);
});
test("database rejects mutation of artifact bytes and historical records", async () => {
  const db = await database();
  for (const [sql, args] of [
    ["UPDATE artifacts SET title=$1 WHERE id=$2", ["tampered", artifact.id]],
    ["DELETE FROM artifacts WHERE id=$1", [artifact.id]],
    [
      "UPDATE content_versions SET title=$1 WHERE content_id=$2",
      ["tampered", content.id],
    ],
    ["DELETE FROM content_blocks WHERE content_id=$1", [content.id]],
    ["DELETE FROM events", []],
  ] as [string, unknown[]][])
    await assert.rejects(db.query(sql, args), /immutable|append.only|不可/i);
});
test("manual publication requires evidence URL and never calls a platform", async () => {
  await assert.rejects(
    savePublication({
      artifact_id: artifact.id,
      platform: "x",
      status: "published",
      note: "",
      url: "",
    }),
    /链接/,
  );
  const pub = await savePublication({
    artifact_id: artifact.id,
    platform: "x",
    status: "published",
    note: "手动登记",
    url: "https://example.com/post/1",
  });
  assert.equal(pub.status, "published");
  assert(pub.published_at);
});
test("image upload rejects executable SVG and re-encodes raster metadata", async () => {
  await assert.rejects(
    saveAsset(Buffer.from("<svg><script>bad()</script></svg>"), "bad.svg"),
    /仅支持/,
  );
  const sharp = (await import("sharp")).default;
  const png = await sharp({
    create: { width: 12, height: 8, channels: 3, background: "#dbe8e0" },
  })
    .png()
    .toBuffer();
  const asset = await saveAsset(png, "test.png");
  assert.equal(asset.mime, "image/webp");
  assert.equal(asset.width, 12);
  assert.equal(asset.height, 8);
  const duplicate = await saveAsset(png, "renamed.png");
  assert.equal(asset.id, duplicate.id);
});
test("content addressed storage rejects traversal and detects tampering keys", async () => {
  await assert.rejects(getBlob("../secret"));
  const bytes = Buffer.from("same blob");
  assert.equal(await putBlob(bytes), await putBlob(bytes));
});
test("API tokens expose the secret once and enforce read/write scopes", async () => {
  const r = await handle(
    request("tokens", "POST", { label: "Read-only agent" }),
  );
  assert.equal(r.status, 201);
  reader = (await r.json()).token;
  const w = await handle(
    request("tokens", "POST", { label: "Writer agent", write: true }),
  );
  writer = (await w.json()).token;
  const list = JSON.stringify(await (await handle(request("tokens"))).json());
  assert(!list.includes(reader));
  assert(!list.includes(writer));
  assert(!list.includes(digestToken(reader)));
  const headers = { Authorization: "Bearer " + reader, cookie: "" };
  assert.equal(
    (await handle(request("contents", "GET", undefined, headers))).status,
    200,
  );
  assert.equal(
    (await handle(request("contents", "POST", input(), headers))).status,
    403,
  );
  assert.equal(
    (await handle(request("backup", "GET", undefined, headers))).status,
    403,
  );
  assert.equal(
    (
      await handle(
        request("contents", "POST", input("API 写入"), {
          Authorization: "Bearer " + writer,
          cookie: "",
        }),
      )
    ).status,
    201,
  );
});
test("session mutations require exact Origin while bearer clients do not use cookies", async () => {
  assert.equal(
    (
      await handle(
        request("contents", "POST", input(), {
          Origin: "https://attacker.invalid",
        }),
      )
    ).status,
    403,
  );
  const req = new Request(base + "/api/contents", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + writer,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input("Agent 无 Cookie 写入")),
  });
  assert.equal((await handle(req)).status, 201);
});
test("API validates JSON, unknown IDs and body size limits", async () => {
  const headers = {
    Cookie: cookie,
    Origin: base,
    "Content-Type": "application/json",
  };
  assert.equal(
    (
      await handle(
        new Request(base + "/api/contents", {
          method: "POST",
          headers,
          body: "invalid",
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handle(
        new Request(base + "/api/contents", {
          method: "POST",
          headers,
          body: "x".repeat(1024 * 1024 + 1),
        }),
      )
    ).status,
    413,
  );
  assert.equal((await handle(request("contents/not-a-uuid"))).status, 404);
});
test("HTML extraction preserves meaning without scripts or surrounding navigation", () => {
  const result = extractHtml(
    '<title>Title</title><nav>Noise</nav><article><h1>Heading</h1><p>Evidence</p><script>steal()</script><blockquote>Quote</blockquote><img src="https://example.com/a.png" alt="Chart"></article>',
  );
  assert.equal(result.title, "Title");
  assert.match(result.markdown, /# Heading/);
  assert(!result.markdown.includes("steal"));
  assert(!result.markdown.includes("Noise"));
  assert.equal(result.images[0].alt, "Chart");
});
test("network ingestion rejects localhost before opening a connection", async () => {
  await assert.rejects(safeFetch("https://127.0.0.1/"), /拒绝/);
  await assert.rejects(safeFetch("https://169.254.169.254/"), /拒绝/);
});
test("MCP supports real initialize/list/call and is read-only", async () => {
  const rpc = async (method: string, params: unknown = {}) => {
    const r = await mcpPost(
      new Request(base + "/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + reader,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  const init = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    clientInfo: { name: "test", version: "1" },
    capabilities: {},
  });
  assert.equal(init.result.serverInfo.name, "content-hub");
  const tools = await rpc("tools/list");
  assert.deepEqual(
    tools.result.tools.map((t: { name: string }) => t.name),
    ["search", "fetch", "list_contents"],
  );
  assert(
    tools.result.tools.every(
      (t: { annotations: { readOnlyHint: boolean } }) =>
        t.annotations.readOnlyHint,
    ),
  );
  const result = await rpc("tools/call", {
    name: "fetch",
    arguments: { id: "content:" + content.id },
  });
  const document = JSON.parse(result.result.content[0].text);
  assert.equal(document.metadata.version, 3);
});
test("MCP rejects cookie-only and cross-origin requests", async () => {
  const init = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Cookie: cookie,
    },
    body: "{}",
  };
  assert.equal((await mcpPost(new Request(base + "/mcp", init))).status, 401);
  const response = await mcpPost(
    new Request(base + "/mcp", {
      ...init,
      headers: {
        ...init.headers,
        Authorization: "Bearer " + reader,
        Origin: "https://attacker.invalid",
      },
    }),
  );
  assert.equal(response.status, 403);
});
test("OAuth requires exact registered redirect, audience and PKCE", () => {
  const p = new URLSearchParams({
    client_id: "test-client",
    redirect_uri: "http://localhost:9000/callback",
    response_type: "code",
    code_challenge: pkceChallenge("v".repeat(50)),
    code_challenge_method: "S256",
    resource: base + "/mcp",
    scope: READ,
  });
  assert.equal(validateAuthorization(p).client.id, "test-client");
  p.set("redirect_uri", "https://attacker.invalid");
  assert.throws(() => validateAuthorization(p));
  p.set("redirect_uri", "http://localhost:9000/callback");
  p.set("resource", "https://attacker.invalid/mcp");
  assert.throws(() => validateAuthorization(p));
});
test("OAuth codes are single-use and refresh replay revokes the token family", async () => {
  const verifier = "v".repeat(50);
  const redirect = "http://localhost:9000/callback";
  const query = new URLSearchParams({
    client_id: "test-client",
    redirect_uri: redirect,
    response_type: "code",
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    resource: base + "/mcp",
    scope: READ,
    state: "csrf-value",
  }).toString();
  const approval = await handle(request("oauth/authorize", "POST", { query }));
  assert.equal(approval.status, 200);
  const target = new URL((await approval.json()).redirect);
  assert.equal(target.searchParams.get("state"), "csrf-value");
  const code = target.searchParams.get("code")!;
  const tokenRequest = (params: Record<string, string>) =>
    exchange(
      new Request(base + "/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: "test-client",
          resource: base + "/mcp",
          ...params,
        }).toString(),
      }),
    );
  assert.equal(
    (
      await tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
        code_verifier: "wrong".repeat(10),
      })
    ).status,
    400,
  );
  const response = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
    code_verifier: verifier,
  });
  assert.equal(response.status, 200);
  const tokens = await response.json();
  assert(tokens.access_token);
  assert(tokens.refresh_token);
  const authenticated = await authenticate(
    new Request(base + "/mcp", {
      headers: { Authorization: "Bearer " + tokens.access_token },
    }),
    false,
    false,
    "mcp",
  );
  assert.equal(authenticated.token.kind, "access");
  assert.equal(
    (
      await tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
        code_verifier: verifier,
      })
    ).status,
    400,
  );
  const rotated = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });
  assert.equal(rotated.status, 200);
  const next = await rotated.json();
  assert.equal(
    (
      await tokenRequest({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      })
    ).status,
    400,
  );
  await assert.rejects(
    authenticate(
      new Request(base + "/mcp", {
        headers: { Authorization: "Bearer " + next.access_token },
      }),
      false,
      false,
      "mcp",
    ),
    /无效/,
  );
});
test("backup contains original blobs and history but no login/API credentials", async () => {
  backup = await exportBackup();
  assert(backup.blobs[artifact.sha256]);
  assert.equal(
    backup.tables.content_versions.filter((v) => v.content_id === content.id)
      .length,
    3,
  );
  assert(!("tokens" in backup.tables));
  const serialized = JSON.stringify(backup);
  assert(!serialized.includes(reader));
  assert(!serialized.includes(writer));
  assert(!serialized.includes(process.env.OWNER_PASSWORD_HASH!));
});
test("process restart reopens the persistent database and its frozen files", async () => {
  await closeDatabase();
  assert.equal((await getContent(content.id)).version, 3);
  assert.equal(sha256(await getBlob(artifact.sha256)), artifact.sha256);
});
test("restore refuses a non-empty installation, then round-trips into a new one", async () => {
  await assert.rejects(restoreBackup(backup), /为空/);
  await closeDatabase();
  process.env.DATA_DIR = restoredRoot;
  process.env.DATABASE_URL = restoreDatabase;
  const tampered = structuredClone(backup);
  tampered.blobs[artifact.sha256] = Buffer.from("tampered").toString("base64");
  await assert.rejects(restoreBackup(tampered), /校验失败/);
  await restoreBackup(backup);
  assert.equal((await getContent(content.id, 1)).title, "Content Hub 集成测试");
  assert.equal((await getContent(content.id)).version, 3);
  assert.equal(sha256(await getBlob(artifact.sha256)), artifact.sha256);
  assert.equal(
    (await (await database()).query("SELECT * FROM tokens")).length,
    0,
  );
});
