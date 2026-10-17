import type { Database } from "./db.ts";
import { blobMetadata, isMissingBlob, listStoredBlobs, verifyBlobBytes } from "./storage-inspection.ts";
/** Report only. Candidates are NOT safe-to-delete instructions. */
export async function reconcileBlobs(db: Database, options: {
    verify?: boolean;
    limit?: number;
    budgetMs?: number;
} = {}) {
    const limit = options.limit ?? 1000, budget = options.budgetMs ?? 60000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000 || !Number.isInteger(budget) || budget < 1000 || budget > 300000)
        throw new Error("Invalid reconciliation limits");
    const started = Date.now();
    const refs = await db.transaction(async (tx) => {
        await tx.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        return tx.query<{
            sha256: string;
        }>("SELECT sha256 FROM sources UNION SELECT sha256 FROM assets UNION SELECT sha256 FROM artifacts UNION SELECT sha256 FROM agent_files ORDER BY sha256 LIMIT $1", [limit + 1]);
    });
    const known = new Set(refs.map(r => r.sha256)), missing: string[] = [], mismatched: string[] = [], unreadable: string[] = [];
    let checked = 0, complete = refs.length <= limit;
    for (const ref of refs.slice(0, limit)) {
        if (Date.now() - started > budget) {
            complete = false;
            break;
        }
        try {
            await blobMetadata(ref.sha256);
            if (options.verify && !await verifyBlobBytes(ref.sha256))
                mismatched.push(ref.sha256);
        }
        catch (e) {
            (isMissingBlob(e) ? missing : unreadable).push(ref.sha256);
        }
        checked++;
    }
    let inventory: Awaited<ReturnType<typeof listStoredBlobs>> | undefined;
    let inventoryError = false;
    if (Date.now() - started <= budget) {
        try {
            inventory = await listStoredBlobs(limit);
        }
        catch {
            inventoryError = true;
        }
    }
    const candidates = (complete ? inventory?.entries ?? [] : []).filter(v => !known.has(v.sha256) && v.modified_at && Date.parse(v.modified_at) < started - 86400000).map(v => v.sha256);
    return {
        data_modified: false, verified_bytes: !!options.verify, checked_at: new Date(started).toISOString(),
        references_complete: complete, reference_hashes_returned: Math.min(refs.length, limit), checked_references: checked,
        missing, mismatched, unreadable, suspect_orphans: candidates,
        inventory_complete: !!inventory?.complete, inventory_failed: inventoryError, ignored_inventory_entries: inventory?.ignored ?? 0,
        complete: complete && !!inventory?.complete,
        warning: "只读对账；并发写入可能改变引用，疑似孤儿需停止写入后再次核对，不能直接删除。新于24小时的文件不列入候选。S3清单需要单独的ListBucket权限。",
    };
}
