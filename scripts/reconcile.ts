import { loadHubEnv } from "./lib/environment.mjs";
import { assertConfig, printConfigError } from "../src/lib/config.mjs";
try {
    loadHubEnv(process.env.NODE_ENV || "production");
    assertConfig();
}
catch (e) {
    printConfigError(e);
    process.exit(1);
}
const args = process.argv.slice(2);
if (args.some(v => v !== "--verify") || args.length > 1) {
    console.error("Usage: npm run storage:reconcile [-- --verify]. Never deletes or repairs blobs.");
    process.exit(1);
}
const { openDatabase } = await import("../src/lib/db.ts");
const { reconcileBlobs } = await import("../src/lib/reconciliation.ts");
let db: Awaited<ReturnType<typeof openDatabase>> | undefined;
try {
    db = await openDatabase("verify");
    const report = await reconcileBlobs(db, { verify: args.includes("--verify") });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = !report.complete || report.missing.length || report.mismatched.length || report.unreadable.length ? 2 : 0;
}
catch {
    console.error(JSON.stringify({ ok: false, code: "RECONCILIATION_FAILED", data_modified: false, detail: "检查数据库/存储连接、迁移一致性及只读清单权限；PGlite需先停止应用。未输出原始错误或配置。" }));
    process.exitCode = 1;
}
finally {
    await db?.close().catch(() => { });
}
