import { randomUUID } from "node:crypto";
import { z } from "zod";
import { database } from "../db.ts";
import { authenticate, issueToken } from "../auth.ts";
import { readJson } from "../http.ts";
import { idSchema, permissions } from "./contracts.ts";
import { AgentError } from "./errors.ts";
const agentInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    project_ids: z.array(idSchema).min(1).max(50),
    scopes: z.array(z.enum(permissions)).min(1).max(permissions.length),
  })
  .strict();
export async function admin(request: Request, parts: string[]) {
  await authenticate(request, request.method !== "GET", true, "v1");
  const db = await database();
  if (parts.length === 0 && request.method === "GET") {
    const projects = await db.query(
      "SELECT id,name,change_seq::text,created_at FROM hub_projects ORDER BY created_at,id",
    );
    const agents = await db.query(
      "SELECT a.*,(SELECT MAX(c.created_at) FROM hub_calls c WHERE c.actor_id='agent:'||a.id) AS last_call_at,(SELECT COUNT(*)::int FROM tokens t WHERE t.kind='agent' AND t.meta->>'agent_id'=a.id AND t.revoked_at IS NULL AND t.expires_at>now()) AS active_keys FROM hub_agents a ORDER BY a.created_at DESC",
    );
    const calls = await db.query(
      "SELECT * FROM hub_calls ORDER BY created_at DESC,request_id DESC LIMIT 50",
    );
    return { projects, agents, calls, permissions };
  }
  if (
    parts[0] === "projects" &&
    parts.length === 1 &&
    request.method === "POST"
  ) {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(80) })
      .strict()
      .parse(await readJson(request));
    return (
      await db.query(
        "INSERT INTO hub_projects(id,name) VALUES($1,$2) RETURNING id,name",
        [randomUUID(), name],
      )
    )[0];
  }
  if (
    parts[0] === "agents" &&
    parts.length === 1 &&
    request.method === "POST"
  ) {
    const body = agentInput.parse(await readJson(request));
    return db.transaction(async (tx) => {
      for (const id of body.project_ids)
        if (
          !(await tx.query("SELECT id FROM hub_projects WHERE id=$1", [id]))
            .length
        )
          throw new AgentError("NOT_FOUND", "授权项目不存在。", 404);
      const id = randomUUID();
      await tx.query(
        "INSERT INTO hub_agents(id,name,project_ids,scopes) VALUES($1,$2,$3,$4)",
        [
          id,
          body.name,
          [...new Set(body.project_ids)],
          [...new Set(body.scopes)],
        ],
      );
      const key = await issueToken(
        "agent",
        body.name,
        [],
        90 * 86400,
        { agent_id: id },
        tx,
      );
      return { id, name: body.name, token: key.token, expires_in_days: 90 };
    });
  }
  if (
    parts[0] === "agents" &&
    parts.length === 3 &&
    request.method === "POST" &&
    ["revoke", "rotate"].includes(parts[2])
  ) {
    const id = idSchema.parse(parts[1]);
    return db.transaction(async (tx) => {
      const [a] = await tx.query<{ name: string; revoked_at: string | null }>(
        "SELECT name,revoked_at FROM hub_agents WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!a) throw new AgentError("NOT_FOUND", "Agent 不存在。", 404);
      await tx.query(
        "UPDATE tokens SET revoked_at=now() WHERE kind='agent' AND meta->>'agent_id'=$1 AND revoked_at IS NULL",
        [id],
      );
      if (parts[2] === "revoke") {
        await tx.query("UPDATE hub_agents SET revoked_at=now() WHERE id=$1", [
          id,
        ]);
        return { id, revoked: true };
      }
      if (a.revoked_at)
        throw new AgentError(
          "AGENT_REVOKED",
          "此 Agent 已撤销；请创建新的独立授权。",
          403,
        );
      const key = await issueToken(
        "agent",
        a.name,
        [],
        90 * 86400,
        { agent_id: id },
        tx,
      );
      return { id, token: key.token, expires_in_days: 90 };
    });
  }
  throw new AgentError("NOT_FOUND", "管理接口不存在。", 404);
}
