import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { database, closeDatabase } = await import("../src/lib/db.ts");
const db = await database();
console.log(`Migrations verified (${db.engine}).`);
await closeDatabase();
