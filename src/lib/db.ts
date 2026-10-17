import { readFile, readdir, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
export interface Database {
  engine: "postgres" | "pglite";
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export const dataDirectory = () => resolve(process.env.DATA_DIR || ".data");
async function connect(existingOnly = false): Promise<Database> {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
    });
    const db: Database = {
      engine: "postgres",
      query: async <T>(s: string, p: unknown[] = []) =>
        (await pool.query(s, p)).rows as T[],
      exec: async (s) => {
        await pool.query(s);
      },
      transaction: async (fn) => {
        const client = await pool.connect();
        const tx: Database = {
          ...db,
          query: async <T>(s: string, p: unknown[] = []) =>
            (await client.query(s, p)).rows as T[],
          exec: async (s) => {
            await client.query(s);
          },
          transaction: (fn) => fn(tx),
          close: async () => {},
        };
        try {
          await client.query("BEGIN");
          const result = await fn(tx);
          await client.query("COMMIT");
          return result;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
    return db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  if (existingOnly) {
    if (!(await readdir(join(dataDirectory(), "postgres"))).length)
      throw new Error("Existing database required in verify mode");
  } else await mkdir(dataDirectory(), { recursive: true, mode: 0o700 });
  const pg = new PGlite(join(dataDirectory(), "postgres"));
  const db: Database = {
    engine: "pglite",
    query: async <T>(s: string, p: unknown[] = []) =>
      (await pg.query<T>(s, p)).rows,
    exec: async (s) => {
      await pg.exec(s);
    },
    transaction: (fn) =>
      pg.transaction(async (client) => {
        const tx: Database = {
          ...db,
          query: async <T>(s: string, p: unknown[] = []) =>
            (await client.query<T>(s, p)).rows,
          exec: async (s) => {
            await client.exec(s);
          },
          transaction: (fn) => fn(tx),
          close: async () => {},
        };
        return fn(tx);
      }),
    close: () => pg.close(),
  };
  return db;
}
async function migrate(db: Database) {
  await db.transaction(async (tx) => {
    if (tx.engine === "postgres")
      await tx.query("SELECT pg_advisory_xact_lock(709201901)");
    await tx.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const root = resolve("migrations");
    for (const name of (await readdir(root))
      .filter((n) => /^\d+.*\.sql$/.test(n))
      .sort()) {
      const sql = await readFile(join(root, name), "utf8");
      const digest = createHash("sha256").update(sql).digest("hex");
      const existing = await tx.query<{ sha256: string }>(
        "SELECT sha256 FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (existing[0]) {
        if (existing[0].sha256 !== digest)
          throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await tx.exec(sql);
      await tx.query(
        "INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)",
        [name, digest],
      );
    }
  });
}
/** Checks exact migration names and bytes, with no CREATE/ALTER statements. */
export async function verifyMigrations(db: Database): Promise<number> {
  const root = resolve("migrations");
  const names = (await readdir(root)).filter(n => /^\d+.*\.sql$/.test(n)).sort();
  const applied = await db.query<{ name: string; sha256: string }>(
    "SELECT name,sha256 FROM schema_migrations ORDER BY name",
  );
  if (names.length !== applied.length) throw new Error("Schema version mismatch");
  for (const [i, name] of names.entries()) {
    const digest = createHash("sha256").update(await readFile(join(root, name))).digest("hex");
    if (applied[i].name !== name || applied[i].sha256 !== digest)
      throw new Error("Schema checksum mismatch");
  }
  return names.length;
}
export type MigrationMode = "auto" | "verify";
/** Separate connection for maintenance. Callers must close it. */
export async function openDatabase(mode: MigrationMode = "verify"): Promise<Database> {
  if (!["auto", "verify"].includes(mode)) throw new Error("Invalid migration mode");
  const db = await connect(mode === "verify");
  try {
    if (mode === "auto") await migrate(db);
    else await verifyMigrations(db);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
const globalDb = globalThis as typeof globalThis & {
  __contentHubDatabase?: Promise<Database>;
};
export function database(): Promise<Database> {
  if (!globalDb.__contentHubDatabase)
    globalDb.__contentHubDatabase = openDatabase(
      (process.env.HUB_MIGRATIONS || "auto") as MigrationMode,
    )
      .catch((e) => {
        delete globalDb.__contentHubDatabase;
        throw e;
      });
  return globalDb.__contentHubDatabase;
}
export async function closeDatabase() {
  const db = globalDb.__contentHubDatabase;
  delete globalDb.__contentHubDatabase;
  if (db) await (await db).close();
}
