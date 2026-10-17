import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, utimes, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { database, closeDatabase, openDatabase, verifyMigrations } from "../src/lib/db.ts";
import { issueToken, authenticate } from "../src/lib/auth.ts";
import { hashPassword, digestToken } from "../src/lib/crypto.ts";
import { rateLimit, RateLimitError } from "../src/lib/rate-limit.ts";
import { problem, problemResponse } from "../src/lib/agent/problem.ts";
import { errorResponse } from "../src/lib/http.ts";
import { securityHttp } from "../src/lib/security.ts";
import { healthHttp, resetHealthCache, storageDiagnostic } from "../src/lib/health.ts";
import { observeHttp, responseLog } from "../src/lib/observability.ts";
import { reconcileBlobs } from "../src/lib/reconciliation.ts";
import { putBlob, blobKey } from "../src/lib/storage.ts";
import { saveSource, saveContent, renderArtifact, getContent } from "../src/lib/repository.ts";
import { exportBackup, restoreBackup } from "../src/lib/backup.ts";
const origin = "http://localhost:3000", pass = "synthetic-operations-password-only";
let dir: string, restored: string, primaryUrl = "", restoreUrl = "", schemas: string[] = [];
async function session() { return issueToken("session", "owner", ["content:read", "content:write"], 43200, { password_fingerprint: digestToken(process.env.OWNER_PASSWORD_HASH!) }); }
function request(path: string, token: string, method = "GET", body?: unknown, requestOrigin = origin) { return new Request(origin + path, { method, headers: { Cookie: "hub_session=" + token, Origin: requestOrigin, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
before(async () => {
    dir = await mkdtemp(join(tmpdir(), "hub-ops-"));
    restored = await mkdtemp(join(tmpdir(), "hub-ops-restore-"));
    if (process.env.TEST_DATABASE_URL) {
        const { Client } = await import("pg");
        const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
        await c.connect();
        schemas = ["ops_" + randomUUID().replaceAll("-", ""), "restore_" + randomUUID().replaceAll("-", "")];
        for (const s of schemas)
            await c.query(`CREATE SCHEMA ${s}`);
        await c.end();
        const url = (s: string) => { const u = new URL(process.env.TEST_DATABASE_URL!); u.searchParams.set("options", "-c search_path=" + s); return u.href; };
        primaryUrl = url(schemas[0]);
        restoreUrl = url(schemas[1]);
    }
    Object.assign(process.env, { APP_URL: origin, DATA_DIR: dir, DATABASE_URL: primaryUrl, STORAGE_DRIVER: "local", HUB_MIGRATIONS: "auto", OWNER_PASSWORD_HASH: hashPassword(pass) });
    await database();
});
after(async () => {
    await closeDatabase();
    if (schemas.length) {
        const { Client } = await import("pg");
        const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
        await c.connect();
        for (const s of schemas)
            await c.query(`DROP SCHEMA ${s} CASCADE`);
        await c.end();
    }
    await rm(dir, { recursive: true, force: true });
    await rm(restored, { recursive: true, force: true });
});
test("rate limit wait reflects the shared database window rather than fixed 60 seconds", async () => {
    const k = randomUUID();
    await rateLimit(k, 1, 3600);
    let error: unknown;
    try {
        await rateLimit(k, 1, 3600);
    }
    catch (e) {
        error = e;
    }
    assert.ok(error instanceof RateLimitError);
    const db = await database();
    const [clock] = await db.query<{
        remaining: number;
    }>("SELECT ceil((window_start+3600000-extract(epoch FROM clock_timestamp())*1000)/1000)::int remaining FROM rate_limits WHERE key=$1 ORDER BY window_start DESC LIMIT 1", [digestToken(k)]);
    assert.ok(error.retryAfterSeconds >= 1 && error.retryAfterSeconds <= 3600);
    assert.ok(Math.abs(error.retryAfterSeconds - clock.remaining) <= 1);
    const detail = problem(error);
    assert.ok("retry_after_seconds" in detail);
    assert.equal(detail.retry_after_seconds, error.retryAfterSeconds);
    assert.equal(problemResponse(error).headers.get("retry-after"), String(error.retryAfterSeconds));
    assert.equal(errorResponse(error).headers.get("retry-after"), String(error.retryAfterSeconds));
});
test("legacy and Agent errors preserve arbitrary legitimate window lengths", async () => {
    for (const seconds of [1, 17, 899, 3599]) {
        const e = new RateLimitError(seconds), a = problemResponse(e), b = errorResponse(e);
        assert.equal(a.status, 429);
        assert.equal(b.status, 429);
        assert.equal((await a.json()).retry_after_seconds, seconds);
        assert.equal((await b.json()).retry_after_seconds, seconds);
    }
});
test("liveness requires no working database; readiness gives no infrastructure details", async () => {
    const a = await healthHttp(new Request(origin + "/api/health/live"));
    assert.deepEqual(await a.json(), { ok: true });
    resetHealthCache();
    const b = await healthHttp(new Request(origin + "/api/health/ready"));
    assert.equal(b.status, 200);
    assert.deepEqual(await b.json(), { ok: true });
    assert.equal(b.headers.get("cache-control"), "no-store");
});
test("diagnostics require an owner session; empty storage is not falsely marked tested", async () => {
    assert.equal((await healthHttp(new Request(origin + "/api/health/diagnostics"))).status, 401);
    const a = await issueToken("api", "agent", ["content:read"], 3600);
    assert.equal((await healthHttp(new Request(origin + "/api/health/diagnostics", { headers: { Authorization: "Bearer " + a.token } }))).status, 403);
    assert.equal((await storageDiagnostic()).status, "not_checked");
    const s = await session(), response = await healthHttp(request("/api/health/diagnostics", s.token));
    const output = await response.text();
    assert.equal(response.status, 200);
    assert.ok(!output.includes(dir));
    assert.ok(!output.includes(process.env.OWNER_PASSWORD_HASH!));
});
test("access overview reveals neither hashes nor raw credentials and identifies current session", async () => {
    const s = await session(), response = await securityHttp(request("/api/security", s.token)), data = await response.json();
    assert.ok(data.sessions.some((v: {
        id: string;
        current: boolean;
    }) => v.id === s.id && v.current));
    assert.ok(!JSON.stringify(data).includes(s.token));
    assert.ok(!JSON.stringify(data).includes("password_fingerprint"));
    assert.ok(!JSON.stringify(data).includes(digestToken(s.token)));
});
test("revocation rejects bearer agents and cross-origin requests", async () => {
    const s = await session(), a = await issueToken("api", "unprivileged", ["content:write"], 3600);
    const b = { action: "all_access", password: pass };
    assert.equal((await securityHttp(new Request(origin + "/api/security/revoke", { method: "POST", headers: { Authorization: "Bearer " + a.token, "Content-Type": "application/json" }, body: JSON.stringify(b) }))).status, 403);
    assert.equal((await securityHttp(request("/api/security/revoke", s.token, "POST", b, "https://attacker.invalid"))).status, 403);
    await authenticate(request("/api/security", s.token), false, true);
});
test("wrong password and invalid action cannot mutate credentials", async () => {
    const s = await session();
    const response = await securityHttp(request("/api/security/revoke", s.token, "POST", { action: "all_access", password: "wrong" }));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "REAUTHENTICATION_FAILED");
    assert.equal((await securityHttp(request("/api/security/revoke", s.token, "POST", { action: "other_sessions", password: pass, token_id: "unexpected" }))).status, 422);
    await authenticate(request("/api/security", s.token), false, true);
});
test("revoke other sessions keeps the current session and Agent credentials", async () => {
    const current = await session(), other = await session(), agent = await issueToken("api", "keep", ["content:read"], 3600);
    const response = await securityHttp(request("/api/security/revoke", current.token, "POST", { action: "other_sessions", password: pass }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).signed_out, false);
    await authenticate(request("/api/security", current.token), false, true);
    await assert.rejects(authenticate(request("/api/security", other.token), false, true));
    await authenticate(new Request(origin + "/api/contents", { headers: { Authorization: "Bearer " + agent.token } }));
});
test("single session revocation cannot target an Agent token", async () => {
    const s = await session(), agent = await issueToken("api", "kept", ["content:read"], 3600);
    const response = await securityHttp(request("/api/security/revoke", s.token, "POST", { action: "session", password: pass, token_id: agent.id }));
    assert.equal((await response.json()).revoked, 0);
    await authenticate(new Request(origin + "/api/contents", { headers: { Authorization: "Bearer " + agent.token } }));
});
test("stop all Agent access revokes codes/access/refresh/API but keeps owner and data", async () => {
    const s = await session(), db = await database();
    await db.query("INSERT INTO agents(id,name,scopes,project_ids) VALUES($1,'synthetic',$2,$3)", [randomUUID(), ["contents:read"], ["default"]]);
    for (const kind of ["api", "code", "access", "refresh"])
        await issueToken(kind, "synthetic", [], 3600);
    const response = await securityHttp(request("/api/security/revoke", s.token, "POST", { action: "agent_access", password: pass }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).signed_out, false);
    assert.equal((await db.query("SELECT id FROM agents WHERE active")).length, 0);
    assert.equal((await db.query("SELECT id FROM tokens WHERE kind<>'session' AND revoked_at IS NULL")).length, 0);
    await authenticate(request("/api/security", s.token), false, true);
    assert.ok((await db.query("SELECT id FROM events WHERE type='security.access_revoked'")).length > 0);
});
test("emergency revoke signs the current session out and keeps an immutable audit entry", async () => {
    const s = await session(), response = await securityHttp(request("/api/security/revoke", s.token, "POST", { action: "all_access", password: pass }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).signed_out, true);
    assert.match(response.headers.get("set-cookie")!, /Max-Age=0/);
    await assert.rejects(authenticate(request("/api/security", s.token), false, true));
    const db = await database();
    assert.equal((await db.query("SELECT id FROM tokens WHERE revoked_at IS NULL")).length, 0);
    const audit = JSON.stringify(await db.query("SELECT payload FROM events WHERE type='security.access_revoked'"));
    assert.ok(!audit.includes(pass));
});
test("metadata probe and full reconciliation distinguish present, corrupted and missing bytes", async () => {
    const source = await saveSource(Buffer.from("Synthetic data"), { title: "synthetic recovery source", markdown: "Synthetic data", mime: "text/plain" });
    assert.equal((await storageDiagnostic()).status, "ok");
    let report = await reconcileBlobs(await database(), { verify: true });
    assert.equal(report.complete, true);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.mismatched, []);
    const path = join(dir, blobKey(source.sha256));
    await writeFile(path, "corrupted");
    report = await reconcileBlobs(await database(), { verify: true });
    assert.deepEqual(report.mismatched, [source.sha256]);
    assert.equal((await readFile(path)).toString(), "corrupted");
    await rm(path);
    report = await reconcileBlobs(await database());
    assert.deepEqual(report.missing, [source.sha256]);
    await putBlob(Buffer.from("Synthetic data"));
});
test("old orphan candidates are reported but never removed; fresh blobs excluded", async () => {
    const old = await putBlob(Buffer.from("old orphan")), fresh = await putBlob(Buffer.from("fresh in-flight"));
    await utimes(join(dir, blobKey(old)), new Date(0), new Date(0));
    const report = await reconcileBlobs(await database());
    assert.ok(report.suspect_orphans.includes(old));
    assert.ok(!report.suspect_orphans.includes(fresh));
    assert.equal((await readFile(join(dir, blobKey(old)))).toString(), "old orphan");
    assert.equal(report.data_modified, false);
});
test("bounded reconciliation exposes incompleteness instead of inventing a clean full scan", async () => {
    await saveSource(Buffer.from("other"), { title: "other", markdown: "other", mime: "text/plain" });
    const report = await reconcileBlobs(await database(), { limit: 1 });
    assert.equal(report.complete, false);
    assert.equal(report.references_complete, false);
    assert.deepEqual(report.suspect_orphans, []);
});
test("allowlisted response logs exclude secrets, paths, query strings and user body fields", async () => {
    const output = JSON.stringify(responseLog({ requestId: randomUUID(), method: "POST", url: origin + "/api/v1/files?token=VERY_PRIVATE", status: 201, durationMs: 12 }));
    assert.ok(!output.includes("VERY_PRIVATE"));
    assert.ok(output.includes("/api/v1/files"));
    assert.ok(!JSON.stringify(responseLog({ requestId: "SECRET", method: "LEAK", url: origin + "/api/tokens/SECRET/download", status: 200, durationMs: 0 })).includes("SECRET"));
    const previous = console.info;
    let log = "";
    console.info = (v) => { log = String(v); };
    try {
        const response = await observeHttp(new Request(origin + "/api/v1/files?private=secret", { headers: { Authorization: "Bearer SECRET" } }), async () => new Response("PRIVATE_BYTES", { status: 200 }));
        assert.ok(response.headers.get("x-request-id"));
        assert.ok(!log.includes("SECRET"));
        assert.ok(!log.includes("PRIVATE_BYTES"));
        assert.equal(JSON.parse(log).event, "http.response_prepared");
    }
    finally {
        console.info = previous;
    }
});
test("logging failure cannot change a successfully prepared response", async () => {
    const previous = console.info;
    console.info = () => { throw Error("sink down"); };
    try {
        assert.equal((await observeHttp(new Request(origin + "/api/v1/contents"), async () => new Response("ok", { status: 201 }))).status, 201);
    }
    finally {
        console.info = previous;
    }
});
test("verify mode detects drift without repairing migration records", async () => {
    const db = await database();
    assert.equal(await verifyMigrations(db), 2);
    const [row] = await db.query<{
        name: string;
        sha256: string;
    }>("SELECT name,sha256 FROM schema_migrations ORDER BY name LIMIT 1");
    await db.query("UPDATE schema_migrations SET sha256=$1 WHERE name=$2", ["bad", row.name]);
    await assert.rejects(verifyMigrations(db));
    assert.equal((await db.query<{
        sha256: string;
    }>("SELECT sha256 FROM schema_migrations WHERE name=$1", [row.name]))[0].sha256, "bad");
    await db.query("UPDATE schema_migrations SET sha256=$1 WHERE name=$2", [row.sha256, row.name]);
});
test("synthetic backup restores versions and original bytes into an independent empty workspace", async () => {
    const s = await session();
    const db = await database();
    const source = (await db.query<{
        id: string;
    }>("SELECT id FROM sources LIMIT 1"))[0];
    const content = await saveContent({ title: "Recovery drill", blocks: [{ id: randomUUID(), type: "paragraph", text: "Version one", source_refs: [source.id] }], source_ids: [source.id], tags: [], status: "draft" });
    const artifact = await renderArtifact(content.id, 1, "html", "web", "owner");
    await saveContent({ title: "Recovery drill updated", blocks: [{ id: randomUUID(), type: "paragraph", text: "Version two", source_refs: [] }], source_ids: [], tags: [], status: "draft", expected_version: 1 }, content.id);
    const original = await readFile(join(dir, blobKey(artifact.sha256)));
    const backup = await exportBackup();
    assert.ok(!JSON.stringify(backup).includes(s.token));
    await assert.rejects(restoreBackup(backup));
    await closeDatabase();
    process.env.DATA_DIR = restored;
    process.env.DATABASE_URL = restoreUrl;
    try {
        await restoreBackup(backup);
        const restoredDb = await database();
        assert.equal((await getContent(content.id)).version, 2);
        assert.equal((await getContent(content.id, 1)).title, "Recovery drill");
        assert.deepEqual(await readFile(join(restored, blobKey(artifact.sha256))), original);
        assert.equal((await restoredDb.query("SELECT id FROM tokens")).length, 0);
        assert.equal((await restoredDb.query("SELECT id FROM agents WHERE active")).length, 0);
        assert.equal((await reconcileBlobs(restoredDb, { verify: true })).complete, true);
    }
    finally {
        await closeDatabase();
        process.env.DATA_DIR = dir;
        process.env.DATABASE_URL = primaryUrl;
    }
});
test("verify mode reopens an existing database without changing migration checksums", async () => {
    await closeDatabase();
    const db = await openDatabase("verify");
    try {
        assert.equal(await verifyMigrations(db), 2);
    }
    finally {
        await db.close();
    }
});
// Only registered against the explicitly supplied isolated PostgreSQL test service.
if (process.env.TEST_DATABASE_URL)
    test("separate PostgreSQL runtime role can use the Hub without DDL or history write privileges", async () => {
        await closeDatabase();
        const { Client } = await import("pg");
        const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
        await admin.connect();
        const role = "runtime_" + randomUUID().replaceAll("-", ""), password = randomUUID();
        try {
            await admin.query(`CREATE ROLE ${role} LOGIN NOINHERIT PASSWORD '${password}'`);
            const sql = (await readFile("ops/runtime-grants.sql", "utf8")).replaceAll(':"schema"', '"' + schemas[0] + '"').replaceAll(':"runtime_role"', '"' + role + '"');
            await admin.query(sql);
            const u = new URL(primaryUrl);
            u.username = role;
            u.password = password;
            process.env.DATABASE_URL = u.href;
            process.env.HUB_MIGRATIONS = "verify";
            const db = await database();
            assert.equal(await verifyMigrations(db), 2);
            const s = await session();
            const r = await securityHttp(request("/api/security/revoke", s.token, "POST", { action: "other_sessions", password: pass }));
            assert.equal(r.status, 200);
            await rateLimit(randomUUID(), 5, 60);
            const c = await saveContent({ title: "Least privilege", status: "draft", tags: [], source_ids: [], blocks: [{ id: randomUUID(), type: "paragraph", text: "runtime write", source_refs: [] }] });
            assert.equal(c.version, 1);
            await assert.rejects(db.exec("CREATE TABLE runtime_forbidden(id int)"));
            await assert.rejects(db.exec("ALTER TABLE artifacts DISABLE TRIGGER ALL"));
            await assert.rejects(db.exec("DELETE FROM artifacts"));
            await assert.rejects(db.exec("UPDATE schema_migrations SET sha256='bad'"));
            assert.equal(await verifyMigrations(db), 2);
        }
        finally {
            await closeDatabase();
            process.env.DATABASE_URL = primaryUrl;
            process.env.HUB_MIGRATIONS = "auto";
            await admin.query(`DROP OWNED BY ${role}`);
            await admin.query(`DROP ROLE ${role}`);
            await admin.end();
        }
    });
