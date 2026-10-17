import { loadHubEnv } from "./lib/environment.mjs";
import { assertConfig, printConfigError } from "../src/lib/config.mjs";
try {
  loadHubEnv(process.env.NODE_ENV || "production");
  assertConfig();
} catch (e) {
  printConfigError(e);
  process.exit(1);
}
const { database, closeDatabase } = await import("../src/lib/db.ts");
try {
  const db = await database();
  console.log(`Migrations verified (${db.engine}).`);
} catch {
  console.error(
    "迁移未完成。检查数据库连接、权限及迁移文件；未输出连接信息或数据库原始错误。不要删除数据或修改已执行迁移。",
  );
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => {});
}
