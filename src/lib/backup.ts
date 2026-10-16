import { database } from "./db.ts";
import { getBlob, putBlob, sha256 } from "./storage.ts";
import { HubError, object } from "./domain.ts";
export const backupTables = [
  "sources",
  "source_locations",
  "assets",
  "source_images",
  "contents",
  "content_versions",
  "content_blocks",
  "content_sources",
  "artifacts",
  "publications",
  "events",
] as const;
const columns: Record<(typeof backupTables)[number], string[]> = {
  sources: [
    "id",
    "title",
    "original_url",
    "sha256",
    "markdown",
    "mime",
    "trust_level",
    "meta",
    "fetched_at",
  ],
  source_locations: ["source_id", "url", "fetched_at"],
  assets: [
    "id",
    "sha256",
    "mime",
    "bytes",
    "width",
    "height",
    "name",
    "created_at",
  ],
  source_images: ["source_id", "asset_id", "origin_url", "alt", "role"],
  contents: [
    "id",
    "title",
    "status",
    "tags",
    "current_version",
    "search_text",
    "created_at",
    "updated_at",
  ],
  content_versions: [
    "content_id",
    "version",
    "title",
    "status",
    "tags",
    "created_at",
  ],
  content_blocks: ["content_id", "version", "seq", "type", "payload"],
  content_sources: ["content_id", "version", "source_id", "role"],
  artifacts: [
    "id",
    "content_id",
    "content_version",
    "title",
    "kind",
    "variant",
    "sha256",
    "bytes",
    "mime",
    "recipe",
    "created_at",
  ],
  publications: [
    "id",
    "artifact_id",
    "platform",
    "status",
    "url",
    "note",
    "published_at",
    "created_at",
    "updated_at",
  ],
  events: ["id", "type", "actor", "subject_id", "payload", "created_at"],
};
export async function exportBackup() {
  const db = await database();
  const tables = await db.transaction(async (tx) => {
    await tx.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const result: Record<string, Record<string, unknown>[]> = {};
    for (const table of backupTables)
      result[table] = await tx.query(`SELECT * FROM ${table}`);
    return result;
  });
  const hashes = new Set<string>();
  for (const table of ["sources", "assets", "artifacts"])
    for (const row of tables[table]) hashes.add(String(row.sha256));
  const blobs: Record<string, string> = {};
  let total = 0;
  for (const hash of hashes) {
    const bytes = await getBlob(hash);
    total += bytes.length;
    if (total > 50 * 1024 * 1024)
      throw new HubError(
        "网页备份上限为 50 MB，请使用文档中的数据库与存储备份流程",
        413,
      );
    blobs[hash] = bytes.toString("base64");
  }
  return {
    format: "content-hub-backup",
    version: 1,
    created_at: new Date().toISOString(),
    tables,
    blobs,
  };
}
export async function restoreBackup(input: unknown) {
  const data = object(input);
  if (data.format !== "content-hub-backup" || data.version !== 1)
    throw new HubError("不支持的备份格式");
  const tables = object(data.tables),
    blobs = object(data.blobs);
  const db = await database();
  // Refuse merge/overwrite. Restore only into a new installation, preserving immutable history.
  for (const name of backupTables) {
    if ((await db.query(`SELECT 1 FROM ${name} LIMIT 1`)).length)
      throw new HubError("恢复目标必须为空数据库");
    if (!Array.isArray(tables[name])) throw new HubError("备份表不完整");
  }
  for (const [hash, encoded] of Object.entries(blobs)) {
    if (
      typeof encoded !== "string" ||
      sha256(Buffer.from(encoded, "base64")) !== hash
    )
      throw new HubError("备份文件摘要校验失败");
  }
  for (const name of ["sources", "assets", "artifacts"])
    for (const raw of tables[name] as unknown[]) {
      const row = object(raw);
      if (typeof row.sha256 !== "string" || !(row.sha256 in blobs))
        throw new HubError("备份缺少关联文件");
    }
  for (const [hash, encoded] of Object.entries(blobs)) {
    if ((await putBlob(Buffer.from(encoded as string, "base64"))) !== hash)
      throw new HubError("存储校验失败");
  }
  await db.transaction(async (tx) => {
    // Lock all target tables before the second emptiness check to prevent a concurrent write.
    await tx.exec(
      `LOCK TABLE ${backupTables.join(",")} IN ACCESS EXCLUSIVE MODE`,
    );
    for (const table of backupTables) {
      if ((await tx.query(`SELECT 1 FROM ${table} LIMIT 1`)).length)
        throw new HubError("数据库在恢复前已被其他进程写入");
      for (const raw of tables[table] as unknown[]) {
        const row = object(raw);
        const cols = columns[table];
        await tx.query(
          `INSERT INTO ${table}(${cols.join(",")}) VALUES(${cols.map((_c, i) => "$" + (i + 1)).join(",")})`,
          cols.map((c) =>
            ["meta", "payload", "recipe"].includes(c)
              ? JSON.stringify(row[c])
              : (row[c] ?? null),
          ),
        );
      }
    }
    await tx.query(
      "SELECT setval(pg_get_serial_sequence('events','id'),COALESCE((SELECT MAX(id) FROM events),1),(SELECT COUNT(*)>0 FROM events))",
    );
  });
}
