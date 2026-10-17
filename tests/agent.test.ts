import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { agentHttp } from "../src/lib/agent/transport.ts";
import { POST as mcp } from "../src/app/mcp/route.ts";
import { handle } from "../src/lib/api.ts";
import { hashPassword, pkceChallenge } from "../src/lib/crypto.ts";
import { database, closeDatabase } from "../src/lib/db.ts";
import { openApiDocument } from "../src/lib/agent/openapi.ts";
import { contracts } from "../src/lib/agent/contracts.ts";
import { SCOPES } from "../src/lib/agent/principal.ts";
import { exportBackup, restoreBackup } from "../src/lib/backup.ts";
import { exchange } from "../src/lib/oauth.ts";
const base = "http://localhost:3000";
let dir: string,
  restored: string,
  cookie: string,
  writer: string,
  reader: string,
  outsider: string,
  agentId: string,
  projectId: string,
  sourceId: string,
  contentId: string,
  fileId: string,
  artifactId: string,
  primaryUrl = "",
  restoredUrl = "";
let schemas: string[] = [];
const pass = "Synthetic-agent-tests-only-password";
async function call(
  path: string,
  token: string,
  method = "GET",
  body?: unknown,
  key?: string,
) {
  const r = await agentHttp(
    new Request(base + "/api/v1/" + path, {
      method,
      headers: {
        ...(token === "owner"
          ? { Cookie: cookie, Origin: base }
          : { Authorization: "Bearer " + token }),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const json = await r.json();
  return { status: r.status, headers: r.headers, json, data: json.data };
}
async function identity(
  name: string,
  scopes: readonly string[],
  project_ids = ["default"],
) {
  const a = await call("agents", "owner", "POST", {
    name,
    scopes,
    project_ids,
  });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  const t = await call(`agents/${a.data.id}/tokens`, "owner", "POST", {});
  assert.equal(t.status, 201);
  return { id: a.data.id, token: t.data.token };
}
async function rpc(
  token: string,
  name: string,
  args: unknown = {},
  method = "tools/call",
) {
  const r = await mcp(
    new Request(base + "/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: method === "tools/call" ? { name, arguments: args } : args,
      }),
    }),
  );
  return { status: r.status, json: await r.json() };
}
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "hub-agent-"));
  restored = await mkdtemp(join(tmpdir(), "hub-agent-restore-"));
  if (process.env.TEST_DATABASE_URL) {
    const { Client } = await import("pg");
    const a = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await a.connect();
    schemas = [
      "agent_" + randomUUID().replaceAll("-", ""),
      "agent_restore_" + randomUUID().replaceAll("-", ""),
    ];
    for (const s of schemas) await a.query(`CREATE SCHEMA ${s}`);
    await a.end();
    const u = (s: string) => {
      const url = new URL(process.env.TEST_DATABASE_URL!);
      url.searchParams.set("options", "-c search_path=" + s);
      return url.href;
    };
    primaryUrl = u(schemas[0]);
    restoredUrl = u(schemas[1]);
  }
  process.env.APP_URL = base;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = primaryUrl;
  process.env.STORAGE_DRIVER = "local";
  process.env.OWNER_PASSWORD_HASH = hashPassword(pass);
  const r = await handle(
    new Request(base + "/api/auth/login", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ password: pass }),
    }),
  );
  assert.equal(r.status, 200);
  cookie = r.headers.get("set-cookie")!.split(";")[0];
  const a = await identity("Writer", SCOPES);
  writer = a.token;
  agentId = a.id;
  reader = (
    await identity("Reader", [
      "contents:read",
      "sources:read",
      "artifacts:read",
      "changes:read",
    ])
  ).token;
  projectId = (await call("projects", "owner", "POST", { name: "独立项目" }))
    .data.id;
  outsider = (await identity("Other project", SCOPES, [projectId])).token;
});
after(async () => {
  await closeDatabase();
  if (schemas.length) {
    const { Client } = await import("pg");
    const a = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await a.connect();
    for (const s of schemas) await a.query(`DROP SCHEMA ${s} CASCADE`);
    await a.end();
  }
  await rm(dir, { recursive: true, force: true });
  await rm(restored, { recursive: true, force: true });
});

test("unauthenticated gateway returns machine-readable RFC 9457 problem", async () => {
  const r = await agentHttp(new Request(base + "/api/v1/capabilities"));
  assert.equal(r.status, 401);
  assert.match(r.headers.get("content-type")!, /application\/problem\+json/);
  const d = await r.json();
  assert.equal(d.code, "UNAUTHENTICATED");
  assert(d.request_id);
  assert.equal(d.retryable, false);
});
test("capabilities report verified identity, project grants and actual supported features", async () => {
  const r = await call("capabilities", writer);
  assert.equal(r.status, 200);
  assert.equal(r.data.principal.id, agentId);
  assert.deepEqual(
    r.data.projects.map((p: { id: string }) => p.id),
    ["default"],
  );
  assert.equal(r.data.supported.background_jobs, false);
  assert.equal(r.data.supported.mcp_write, true);
});
test("scoped agent cannot bypass authorization through legacy API or admin", async () => {
  for (const path of ["hub", "contents", "sources", "tokens"]) {
    const r = await handle(
      new Request(base + "/api/" + path, {
        headers: { Authorization: "Bearer " + writer },
      }),
    );
    assert.equal(r.status, 403);
  }
  assert.equal((await call("admin", writer)).status, 403);
});
test("unknown fields and missing idempotency keys produce field errors", async () => {
  const r = await call("sources", writer, "POST", {
    project_id: "default",
    title: "资料",
    markdown: "正文",
    actor: "owner",
  });
  assert.equal(r.status, 422);
  assert.equal(r.json.code, "VALIDATION_ERROR");
  assert(
    r.json.errors.some((e: { path: string }) => e.path === "idempotency_key"),
  );
});
test("REST source save returns an immutable snapshot and conservative trust", async () => {
  const r = await call(
    "sources",
    writer,
    "POST",
    {
      project_id: "default",
      title: "研究资料",
      markdown: "事实应当可追溯。",
      original_url: "https://example.org/research",
    },
    "source-create-001",
  );
  assert.equal(r.status, 201, JSON.stringify(r.json));
  sourceId = r.data.id;
  assert.equal(r.data.trust, "unverified");
  assert.equal(r.json.meta.committed, true);
});
test("MCP and REST share the same idempotency receipt", async () => {
  const r = await rpc(writer, "source_save", {
    project_id: "default",
    title: "研究资料",
    markdown: "事实应当可追溯。",
    original_url: "https://example.org/research",
    idempotency_key: "source-create-001",
  });
  assert.equal(r.status, 200);
  assert(!r.json.result.isError, JSON.stringify(r.json));
  assert.equal(r.json.result.structuredContent.data.id, sourceId);
  assert.equal(r.json.result.structuredContent.meta.replayed, true);
});
test("same key with different payload is rejected without mutation", async () => {
  const r = await call(
    "sources",
    writer,
    "POST",
    { project_id: "default", title: "新标题", markdown: "已变更正文" },
    "source-create-001",
  );
  assert.equal(r.status, 409);
  assert.equal(r.json.code, "IDEMPOTENCY_KEY_REUSED");
});
test("concurrent retries create one article and one committed version", async () => {
  const body = {
    project_id: "default",
    title: "Agent 接力文章",
    markdown: "文章正文依据资料。",
    source_ids: [sourceId],
  };
  const rs = await Promise.all(
    Array.from({ length: 3 }, () =>
      call("contents", writer, "POST", body, "article-create-001"),
    ),
  );
  assert(
    rs.every((r) => r.status === 201),
    JSON.stringify(rs),
  );
  assert.equal(new Set(rs.map((r) => r.data.id)).size, 1);
  assert.equal(rs.filter((r) => !r.json.meta.replayed).length, 1);
  contentId = rs[0].data.id;
  const rows = await (
    await database()
  ).query("SELECT * FROM content_versions WHERE content_id=$1", [contentId]);
  assert.equal(rows.length, 1);
});
test("read-only MCP discovery excludes write tools and has structured output schemas", async () => {
  const r = await rpc(reader, "", {}, "tools/list");
  const tools = r.json.result.tools;
  assert(tools.some((t: { name: string }) => t.name === "content_get"));
  assert(!tools.some((t: { name: string }) => t.name === "content_create"));
  assert(
    tools.every(
      (t: { outputSchema: unknown; annotations: { readOnlyHint: boolean } }) =>
        t.outputSchema && t.annotations.readOnlyHint,
    ),
  );
  const denied = await rpc(reader, "content_create", {});
  assert(denied.json.error || denied.json.result?.isError);
});
test("MCP can read a REST-created article without duplicated full body", async () => {
  const r = await rpc(reader, "content_get", { id: contentId });
  const d = r.json.result.structuredContent.data;
  assert.equal(d.id, contentId);
  assert.equal(d.view, "summary");
  assert.equal(d.blocks, undefined);
  assert.equal(d.text, undefined);
});
test("resource reads and search do not disclose another project", async () => {
  assert.equal((await call("contents/" + contentId, outsider)).status, 404);
  assert.equal((await call("sources/" + sourceId, outsider)).status, 404);
  assert.equal(
    (await call("search?project_id=default&query=Agent", outsider)).status,
    404,
  );
  const r = await call(`search?project_id=${projectId}&query=Agent`, outsider);
  assert.deepEqual(r.data.items, []);
});
test("same source bytes in two projects create separate permissioned records", async () => {
  const r = await call(
    "sources",
    outsider,
    "POST",
    {
      project_id: projectId,
      title: "另一项目的标题",
      markdown: "事实应当可追溯。",
    },
    "other-source-001",
  );
  assert.equal(r.status, 201);
  assert.notEqual(r.data.id, sourceId);
  const own = await call("sources/" + sourceId, writer);
  assert.equal(own.data.title, "研究资料");
});
test("write without read privileges does not accidentally expose search results", async () => {
  const token = (await identity("Write only", ["contents:write"])).token;
  assert.deepEqual(
    (await call("search?project_id=default&query=Agent", token)).data.items,
    [],
  );
  assert.equal((await call("contents/" + contentId, token)).status, 403);
});
test("MCP block mutation preserves stable ID and appends one version", async () => {
  const read = await call(`contents/${contentId}?view=blocks`, writer);
  const b = read.data.blocks[0];
  const r = await rpc(writer, "content_update_blocks", {
    id: contentId,
    expected_version: 1,
    operations: [
      {
        op: "replace",
        block_id: b.id,
        block: { type: "paragraph", text: "MCP Agent 已更新这一段。" },
      },
    ],
    idempotency_key: "patch-001",
  });
  assert(!r.json.result.isError, JSON.stringify(r.json));
  assert.equal(r.json.result.structuredContent.data.version, 2);
  assert.equal(r.json.result.structuredContent.data.block_ids[0], b.id);
});
test("stale writes fail with recovery instruction instead of silent overwrite", async () => {
  const r = await call(
    `contents/${contentId}/blocks`,
    writer,
    "PATCH",
    {
      expected_version: 1,
      operations: [
        { op: "append", block: { type: "paragraph", text: "过期的输入" } },
      ],
    },
    "patch-stale-001",
  );
  assert.equal(r.status, 409);
  assert.equal(r.json.code, "VERSION_CONFLICT");
  assert.equal(r.json.current_version, 2);
  assert.equal(r.json.recovery.action, "read_compare_then_retry");
  assert.equal(r.json.retryable, false);
});
test("concurrent different writers cannot both commit the same base version", async () => {
  const rs = await Promise.all(
    ["one", "two"].map((label) =>
      call(
        `contents/${contentId}/blocks`,
        writer,
        "PATCH",
        {
          expected_version: 2,
          operations: [
            { op: "append", block: { type: "paragraph", text: label } },
          ],
        },
        "concurrent-" + label,
      ),
    ),
  );
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await call(`contents/${contentId}`, writer)).data.version, 3);
});
test("whole block batch rolls back when a later operation is invalid", async () => {
  const r = await call(
    `contents/${contentId}/blocks`,
    writer,
    "PATCH",
    {
      expected_version: 3,
      operations: [
        { op: "append", block: { type: "paragraph", text: "must roll back" } },
        { op: "remove", block_id: "nonexistent" },
      ],
    },
    "invalid-batch-001",
  );
  assert.equal(r.status, 422);
  assert.equal((await call(`contents/${contentId}`, writer)).data.version, 3);
});
test("historical version reads are stable", async () => {
  const r = await call(`contents/${contentId}?view=markdown&version=1`, writer);
  assert.equal(r.data.version, 1);
  assert.equal(r.data.text, "文章正文依据资料。");
});
test("Unicode ranges are resumable and never split a surrogate pair", async () => {
  const text = "中文🙂abc".repeat(1000);
  const c = await call(
    "contents",
    writer,
    "POST",
    { project_id: "default", title: "长文分页", markdown: text },
    "unicode-content-001",
  );
  assert.equal(c.status, 201);
  let offset = 0,
    result = "";
  do {
    const r = await call(
      `contents/${c.data.id}?view=markdown&version=1&offset=${offset}&limit=3999`,
      writer,
    );
    result += r.data.text;
    offset = r.data.range.next_offset;
  } while (offset !== null);
  assert.equal(result, text);
});
test("search cursor is bound to query and authorized project", async () => {
  const r = await call("search?project_id=default&query=文&limit=1", writer);
  assert(r.data.has_more);
  assert(r.data.next_cursor);
  const invalid = await call(
    "search?project_id=default&query=other&cursor=" + r.data.next_cursor,
    writer,
  );
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.code, "INVALID_CURSOR");
});
const fileBytes = Buffer.from(
  "<!doctype html><html><body><h1>Agent 的实际文件</h1></body></html>",
);
async function file(
  token = writer,
  key = "upload-file-001",
  bytes = fileBytes,
  name = "article.html",
  project = "default",
  mime = "text/html",
) {
  const r = await agentHttp(
    new Request(base + "/api/v1/files?project_id=" + project, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": mime,
        "X-Filename": encodeURIComponent(name),
        "Idempotency-Key": key,
      },
      body: new Uint8Array(bytes),
    }),
  );
  return { status: r.status, json: await r.json() };
}
test("actual external file upload retains original bytes and server digest", async () => {
  const r = await file();
  assert.equal(r.status, 201, JSON.stringify(r));
  fileId = r.json.data.id;
  assert.equal(
    r.json.data.sha256,
    createHash("sha256").update(fileBytes).digest("hex"),
  );
  assert.equal((await file()).json.meta.replayed, true);
});
test("local paths and mismatched file formats are not treated as uploads", async () => {
  assert.equal(
    (await file(writer, "bad-path-001", fileBytes, "/tmp/article.html")).status,
    422,
  );
  assert.equal(
    (
      await file(
        writer,
        "bad-image-001",
        fileBytes,
        "image.png",
        "default",
        "image/png",
      )
    ).status,
    415,
  );
});
test("artifact registration binds actual file to an immutable content version", async () => {
  const r = await rpc(writer, "artifact_register", {
    content_id: contentId,
    content_version: 3,
    file_id: fileId,
    kind: "html",
    variant: "web",
    recipe: { model: "agent-reported-label" },
    idempotency_key: "artifact-register-001",
  });
  assert(!r.json.result.isError, JSON.stringify(r.json));
  artifactId = r.json.result.structuredContent.data.id;
  const a = await call("artifacts/" + artifactId, reader);
  assert.equal(a.data.content_version, 3);
  assert.equal(a.data.recipe.principal_id, agentId);
  assert.equal(a.data.recipe.producer_claim.model, "agent-reported-label");
});
test("artifact download verifies bytes and prevents anonymous or cross-project access", async () => {
  const req = (token: string) =>
    new Request(base + `/api/v1/artifacts/${artifactId}/download`, {
      headers: { Authorization: "Bearer " + token },
    });
  const r = await agentHttp(req(reader));
  assert.equal(r.status, 200);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), fileBytes);
  assert.match(r.headers.get("content-disposition")!, /attachment/);
  assert.match(r.headers.get("content-security-policy")!, /sandbox/);
  assert.equal((await agentHttp(req(outsider))).status, 404);
});
test("changes are cursor-based, permission filtered and record authenticated principal", async () => {
  const first = await call("changes?project_id=default&limit=1", reader);
  assert.equal(first.data.items.length, 1);
  assert(first.data.has_more);
  const rest = await call(
    "changes?project_id=default&after=" + first.data.next_cursor,
    reader,
  );
  assert(rest.data.items.every((i: { actor: string }) => i.actor === agentId));
  assert(!rest.data.items.some((i: { kind: string }) => i.kind === "file"));
  const empty = await call(
    "changes?project_id=default&after=" + rest.data.next_cursor,
    reader,
  );
  assert.deepEqual(empty.data.items, []);
});
test("token rotation preserves stable principal and idempotency results", async () => {
  const t = await call(`agents/${agentId}/tokens`, "owner", "POST", {});
  const r = await call(
    "contents",
    t.data.token,
    "POST",
    {
      project_id: "default",
      title: "Agent 接力文章",
      markdown: "文章正文依据资料。",
      source_ids: [sourceId],
    },
    "article-create-001",
  );
  assert.equal(r.data.id, contentId);
  assert.equal(r.data.version, 1);
  assert(r.json.meta.replayed);
});
test("disabling an agent blocks every token and does not delete data", async () => {
  await call("agents/" + agentId, "owner", "PATCH", { active: false });
  assert.equal((await call("capabilities", writer)).status, 403);
  assert.equal((await call("contents/" + contentId, reader)).status, 200);
  await call("agents/" + agentId, "owner", "PATCH", { active: true });
  assert.equal((await call("capabilities", writer)).status, 200);
});
test("OAuth consent exposes requested write scopes and cannot self-escalate", async () => {
  process.env.OAUTH_CLIENTS_JSON = JSON.stringify([
    {
      id: "registered-writer",
      name: "OAuth writer",
      redirect_uris: ["http://localhost:9000/callback"],
      agent_id: agentId,
    },
  ]);
  const query = new URLSearchParams({
    client_id: "registered-writer",
    redirect_uri: "http://localhost:9000/callback",
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: pkceChallenge("v".repeat(50)),
    resource: base + "/mcp",
    scope: "contents:read contents:write",
  });
  const consent = await handle(
    new Request(base + "/api/oauth/authorize?" + query, {
      headers: { Cookie: cookie },
    }),
  );
  assert.equal(consent.status, 200);
  const view = await consent.json();
  assert.equal(view.read_only, false);
  assert.deepEqual(view.project_ids, ["default"]);
  const approval = await handle(
    new Request(base + "/api/oauth/authorize", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: base,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: query.toString() }),
    }),
  );
  const code = new URL((await approval.json()).redirect).searchParams.get(
    "code",
  )!;
  const r = await exchange(
    new Request(base + "/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: "registered-writer",
        grant_type: "authorization_code",
        code,
        code_verifier: "v".repeat(50),
        redirect_uri: "http://localhost:9000/callback",
        resource: base + "/mcp",
      }),
    }),
  );
  assert.equal(r.status, 200);
  const tokens = await r.json();
  assert.equal(tokens.scope, "contents:read contents:write");
  const tools = await rpc(tokens.access_token, "", {}, "tools/list");
  assert(
    tools.json.result.tools.some(
      (t: { name: string }) => t.name === "content_create",
    ),
  );
  assert(
    !tools.json.result.tools.some(
      (t: { name: string }) => t.name === "source_save",
    ),
  );
  query.set("scope", "credentials:read");
  assert.equal(
    (
      await handle(
        new Request(base + "/api/oauth/authorize?" + query, {
          headers: { Cookie: cookie },
        }),
      )
    ).status,
    400,
  );
});
test("OpenAPI is generated for every command with correct HTTP methods and required keys", () => {
  const spec = openApiDocument();
  assert.equal(spec.openapi, "3.1.1");
  for (const [name, c] of Object.entries(contracts)) {
    const path = spec.paths["/api/v1" + c.path] as Record<
      string,
      { operationId: string; parameters: { name: string; required: boolean }[] }
    >;
    assert.equal(path[c.method.toLowerCase()].operationId, name);
    if (c.method !== "GET")
      assert(
        path[c.method.toLowerCase()].parameters.some(
          (p) => p.name === "Idempotency-Key" && p.required,
        ),
      );
  }
  assert.doesNotThrow(() => JSON.stringify(spec));
});
test("audit records operation results without secrets or document bodies", async () => {
  const admin = await call("admin", "owner");
  assert(admin.data.requests.length);
  const log = JSON.stringify(admin.data.requests);
  assert(!log.includes(writer));
  assert(!log.includes("事实应当可追溯"));
  assert(
    admin.data.requests.some(
      (r: { code: string }) => r.code === "VERSION_CONFLICT",
    ),
  );
});
test("malformed filename encoding is a correctable error rather than a retryable server failure", async () => {
  const r = await agentHttp(
    new Request(base + "/api/v1/files?project_id=default", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + writer,
        "Content-Type": "text/plain",
        "X-Filename": "%E0%A4",
        "Idempotency-Key": "bad-filename-01",
      },
      body: "fixture",
    }),
  );
  assert.equal(r.status, 422);
  const e = await r.json();
  assert.equal(e.code, "INVALID_FILENAME");
  assert.equal(e.retryable, false);
});
test("ambiguous upload/write queries are rejected before data creation", async () => {
  for (const query of [
    "project_id=default&project_id=default",
    "project_id=default&actor=owner",
  ]) {
    const r = await agentHttp(
      new Request(base + "/api/v1/files?" + query, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + writer,
          "Content-Type": "text/plain",
          "X-Filename": "fixture.txt",
          "Idempotency-Key": "ambiguous-file-01",
        },
        body: "fixture",
      }),
    );
    assert.equal(r.status, 400);
    assert.equal((await r.json()).retryable, false);
  }
  const r = await call(
    "contents?project_id=default",
    writer,
    "POST",
    { project_id: "default", title: "do not store", markdown: "fixture" },
    "ambiguous-write-01",
  );
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "UNKNOWN_PARAMETER");
});
test("JSON transport rejects malformed UTF-8 instead of replacing original characters", async () => {
  const bytes = Buffer.concat([
    Buffer.from('{"project_id":"default","title":"'),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('","markdown":"fixture"}'),
  ]);
  const r = await agentHttp(
    new Request(base + "/api/v1/contents", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + writer,
        "Content-Type": "application/json",
        "Idempotency-Key": "invalid-utf8-01",
      },
      body: bytes,
    }),
  );
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "INVALID_ENCODING");
});
test("JSON media type is exact but accepts case and parameter variations", async () => {
  const body = JSON.stringify({
    project_id: "default",
    title: "media fixture",
    markdown: "valid text",
  });
  for (const [mime, expected] of [
    ["application/jsonp", 415],
    ["Application/JSON; charset=utf-8", 201],
  ] as const) {
    const r = await agentHttp(
      new Request(base + "/api/v1/sources", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + writer,
          "Content-Type": mime,
          "Idempotency-Key": "media-fixture-01",
        },
        body,
      }),
    );
    assert.equal(r.status, expected, JSON.stringify(await r.json()));
  }
});
test("REST and MCP reject non-persistable Unicode/NUL with the same recoverable error", async () => {
  for (const markdown of ["has\0nul", "unpaired\uD800"]) {
    const body = {
      project_id: "default",
      title: "invalid text",
      markdown,
      idempotency_key: "invalid-text-" + randomUUID(),
    };
    const rest = await call("sources", writer, "POST", body);
    assert.equal(rest.status, 422);
    assert.equal(rest.json.code, "INVALID_TEXT");
    const remote = await rpc(writer, "source_save", body);
    assert.equal(remote.json.result.isError, true);
    assert.match(JSON.stringify(remote.json.result), /INVALID_TEXT/);
  }
});
test("editor retries reuse the committed ID and version while different payloads cannot reuse a key", async () => {
  const payload = {
    title: "Editor retry " + randomUUID(),
    status: "draft",
    tags: [],
    source_ids: [],
    blocks: [
      {
        id: randomUUID(),
        type: "paragraph",
        text: "first snapshot",
        source_refs: [],
      },
    ],
  };
  const key = "editor-test-" + randomUUID();
  const save = (body: unknown, k: string, id?: string) =>
    handle(
      new Request(base + "/api/contents" + (id ? "/" + id : ""), {
        method: id ? "PATCH" : "POST",
        headers: {
          Cookie: cookie,
          Origin: base,
          "Content-Type": "application/json",
          "Idempotency-Key": k,
        },
        body: JSON.stringify(body),
      }),
    );
  const first = await save(payload, key);
  assert.equal(first.status, 201);
  const c = await first.json();
  const replay = await save(payload, key);
  assert.equal(replay.status, 201);
  assert.equal((await replay.json()).id, c.id);
  const conflict = await save({ ...payload, title: "different" }, key);
  assert.equal(conflict.status, 409);
  const patch = {
    ...payload,
    title: "Editor second version",
    expected_version: 1,
  };
  for (let i = 0; i < 2; i++) {
    const r = await save(patch, key + "-patch", c.id);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).version, 2);
  }
  assert.equal(
    (
      await (
        await database()
      ).query("SELECT * FROM content_versions WHERE content_id=$1", [c.id])
    ).length,
    2,
  );
});

test("data and idempotency survive a process-level database reopen", async () => {
  await closeDatabase();
  const r = await call(
    "sources",
    writer,
    "POST",
    {
      project_id: "default",
      title: "研究资料",
      markdown: "事实应当可追溯。",
      original_url: "https://example.org/research",
    },
    "source-create-001",
  );
  assert.equal(r.data.id, sourceId);
  assert(r.json.meta.replayed);
});
test("V2 backup restores project graph, original files and disabled identities, never bearer tokens", async () => {
  const backup = await exportBackup();
  assert.equal(backup.version, 2);
  assert(!JSON.stringify(backup).includes(writer));
  assert(backup.tables.projects.some((p) => p.id === projectId));
  await closeDatabase();
  process.env.DATA_DIR = restored;
  process.env.DATABASE_URL = restoredUrl;
  await restoreBackup(backup);
  const db = await database();
  assert.equal(
    (await db.query("SELECT * FROM agent_files WHERE id=$1", [fileId])).length,
    1,
  );
  assert.equal(
    (
      await db.query<{ active: boolean }>(
        "SELECT active FROM agents WHERE id=$1",
        [agentId],
      )
    )[0].active,
    false,
  );
  assert.equal((await db.query("SELECT * FROM tokens")).length, 0);
  assert.equal(
    (await db.query("SELECT * FROM sources WHERE project_id=$1", [projectId]))
      .length,
    1,
  );
});
