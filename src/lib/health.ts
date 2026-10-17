import { database, verifyMigrations } from "./db.ts";
import { authenticate } from "./auth.ts";
import { json } from "./http.ts";
import { problemResponse, AgentProblem } from "./agent/problem.ts";
import { blobMetadata, inspectLocalDirectory } from "./storage-inspection.ts";
type Ready = {
    ok: boolean;
    checked_at: string;
};
let cached: Ready | undefined, until = 0, pending: Promise<Ready> | undefined;
export function resetHealthCache() { cached = undefined; until = 0; }
async function inspectReady(): Promise<Ready> {
    let ok = false;
    try {
        const db = await database();
        await db.query("SELECT 1");
        await verifyMigrations(db);
        ok = true;
    }
    catch { /* Public readiness never exposes schema names, credentials or exceptions. */ }
    return { ok, checked_at: new Date().toISOString() };
}
export async function readiness(): Promise<Ready> {
    if (cached && Date.now() < until)
        return cached;
    // Keep one underlying query in flight even when callers time out. No probe stampede.
    if (!pending)
        pending = inspectReady().then(r => { cached = r; until = Date.now() + (r.ok ? 10000 : 3000); return r; }).finally(() => { pending = undefined; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([pending, new Promise<Ready>(resolve => { timer = setTimeout(() => resolve({ ok: false, checked_at: new Date().toISOString() }), 2500); })]);
    }
    finally {
        clearTimeout(timer);
    }
}
export async function storageDiagnostic() {
    try {
        const db = await database();
        const [sample] = await db.query<{
            sha256: string;
        }>("SELECT sha256 FROM sources UNION SELECT sha256 FROM assets UNION SELECT sha256 FROM artifacts UNION SELECT sha256 FROM agent_files LIMIT 1");
        if (!sample) {
            if (process.env.STORAGE_DRIVER !== "s3")
                await inspectLocalDirectory();
            return { status: "not_checked", code: "NO_STORED_SAMPLE", write_checked: false, integrity_checked: false };
        }
        await blobMetadata(sample.sha256);
        return { status: "ok", code: "SAMPLE_METADATA_READABLE", write_checked: false, integrity_checked: false };
    }
    catch {
        return { status: "error", code: "STORAGE_PROBE_FAILED", write_checked: false, integrity_checked: false };
    }
}
let diagnosticPending: ReturnType<typeof storageDiagnostic> | undefined;
let diagnosticCache: Awaited<ReturnType<typeof storageDiagnostic>> | undefined, diagnosticUntil = 0;
async function cachedStorage() {
    if (diagnosticCache && Date.now() < diagnosticUntil)
        return diagnosticCache;
    if (!diagnosticPending)
        diagnosticPending = storageDiagnostic().then(r => { diagnosticCache = r; diagnosticUntil = Date.now() + 30000; return r; }).finally(() => { diagnosticPending = undefined; });
    return diagnosticPending;
}
export async function healthHttp(request: Request) {
    try {
        const u = new URL(request.url);
        if (request.method !== "GET" || u.search)
            throw new AgentProblem(405, "METHOD_NOT_ALLOWED", "健康检查只接受不带参数的 GET。");
        if (u.pathname === "/api/health/live")
            return json({ ok: true });
        if (["/api/health", "/api/health/ready"].includes(u.pathname)) {
            const ready = await readiness();
            return json({ ok: ready.ok }, ready.ok ? 200 : 503);
        }
        if (u.pathname === "/api/health/diagnostics") {
            await authenticate(request, false, true);
            const ready = await readiness();
            const storage = ready.ok ? await cachedStorage() : { status: "not_checked", code: "DATABASE_NOT_READY", write_checked: false, integrity_checked: false };
            return json({ readiness: ready, storage, probe_scope: "database_schema_and_one_blob_metadata", data_modified: false, migration_mode: process.env.HUB_MIGRATIONS || "auto", not_checked: ["storage_write", "full_blob_integrity", "external_agents", "publishing", "backup_recoverability"] });
        }
        throw new AgentProblem(404, "NOT_FOUND", "健康检查路径不存在。");
    }
    catch (error) {
        return problemResponse(error);
    }
}
