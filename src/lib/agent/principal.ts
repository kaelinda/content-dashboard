import { authenticate, READ, WRITE, type Actor } from "../auth.ts";
import { database } from "../db.ts";
import { AgentProblem } from "./problem.ts";
import { SCOPES } from "./scopes.ts";
export { SCOPES } from "./scopes.ts";
export type Scope = (typeof SCOPES)[number];
export type Principal = {
  id: string;
  name: string;
  owner: boolean;
  scopes: string[];
  projects: string[];
  actor: Actor;
  legacy: boolean;
};
export async function resolvePrincipal(
  request: Request,
  transport: "api" | "mcp" = "api",
): Promise<Principal> {
  const actor = await authenticate(
    request,
    !["GET", "HEAD"].includes(request.method),
    false,
    transport,
    true,
  );
  const db = await database();
  if (actor.owner)
    return {
      id: "owner",
      name: "所有者",
      owner: true,
      scopes: [...SCOPES],
      projects: (
        await db.query<{ id: string }>("SELECT id FROM projects ORDER BY id")
      ).map((p) => p.id),
      actor,
      legacy: false,
    };
  if (typeof actor.token.meta.agent_id === "string") {
    const [agent] = await db.query<{
      id: string;
      name: string;
      active: boolean;
      scopes: string[];
      project_ids: string[];
    }>("SELECT * FROM agents WHERE id=$1", [actor.token.meta.agent_id]);
    if (!agent?.active)
      throw new AgentProblem(
        403,
        "AGENT_DISABLED",
        "Agent 已停用或不存在，请联系工作区所有者。",
      );
    return {
      id: agent.id,
      name: agent.name,
      owner: false,
      scopes: actor.scopes.filter((s) => agent.scopes.includes(s)),
      projects: agent.project_ids,
      actor,
      legacy: false,
    };
  }
  // Existing V1 tokens stay compatible, but only the default project is exposed by the new API.
  return {
    id: "legacy:" + actor.token.id,
    name: actor.name,
    owner: false,
    scopes: SCOPES.filter((s) =>
      s.endsWith(":write")
        ? actor.scopes.includes(WRITE)
        : actor.scopes.includes(READ),
    ),
    projects: ["default"],
    actor,
    legacy: true,
  };
}
export function requireScope(p: Principal, scope: string) {
  if (!p.owner && !p.scopes.includes(scope))
    throw new AgentProblem(
      403,
      "INSUFFICIENT_SCOPE",
      "当前 Agent 未获准执行此操作。",
      { required_scope: scope },
    );
}
export function requireProject(p: Principal, id: string) {
  if (!p.projects.includes(id))
    throw new AgentProblem(
      404,
      "NOT_FOUND",
      "项目不存在或不在当前授权范围内。",
    );
}
