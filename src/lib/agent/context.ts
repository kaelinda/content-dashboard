import { AsyncLocalStorage } from "node:async_hooks";
import type { Database } from "../db.ts";
import { HubError } from "../domain.ts";
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
export async function lockProject(db: Database, projectId: string) {
  const rows = await db.query(
    "SELECT id FROM hub_projects WHERE id=$1 FOR UPDATE",
    [projectId],
  );
  if (!rows.length) throw new HubError("项目不存在", 404);
}
export async function resourceProject(
  db: Database,
  kind: string,
  id: string,
): Promise<string | null> {
  const statements: Record<string, string> = {
    content: "SELECT project_id FROM contents WHERE id=$1",
    source: "SELECT project_id FROM sources WHERE id=$1",
    asset: "SELECT project_id FROM assets WHERE id=$1",
    file: "SELECT project_id FROM hub_files WHERE id=$1",
    artifact:
      "SELECT c.project_id FROM artifacts a JOIN contents c ON c.id=a.content_id WHERE a.id=$1",
    publication:
      "SELECT c.project_id FROM publications p JOIN artifacts a ON a.id=p.artifact_id JOIN contents c ON c.id=a.content_id WHERE p.id=$1",
  };
  if (!statements[kind]) return null;
  return (
    (await db.query<{ project_id: string }>(statements[kind], [id]))[0]
      ?.project_id ?? null
  );
}
