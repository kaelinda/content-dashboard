import { z } from "zod";
import { authenticate, rateLimit, sessionCookie } from "./auth.ts";
import { database } from "./db.ts";
import { verifyPassword, digestToken } from "./crypto.ts";
import { event } from "./repository.ts";
import { json } from "./http.ts";
import { readAgentJson } from "./agent/request.ts";
import { AgentProblem, problemResponse } from "./agent/problem.ts";
import { randomUUID } from "node:crypto";
const revokeSchema = z.object({
    action: z.enum(["session", "other_sessions", "agent_access", "all_access"]),
    password: z.string().min(1).max(1024),
    token_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
}).strict().superRefine((v, ctx) => {
    if ((v.action === "session") !== !!v.token_id)
        ctx.addIssue({ code: "custom", path: ["token_id"], message: "只有单会话撤销需要 token_id。" });
});
export async function securityHttp(request: Request): Promise<Response> {
    const requestId = randomUUID();
    try {
        const u = new URL(request.url);
        if (u.search)
            throw new AgentProblem(400, "INVALID_REQUEST", "安全管理不接受查询参数。");
        const actor = await authenticate(request, request.method !== "GET", true);
        const db = await database();
        if (request.method === "GET" && u.pathname === "/api/security") {
            const sessions = await db.query<{
                id: string;
                created_at: string;
                expires_at: string;
            }>("SELECT id,created_at,expires_at FROM tokens WHERE kind='session' AND revoked_at IS NULL AND expires_at>now() AND meta->>'password_fingerprint'=$1 ORDER BY created_at DESC,id LIMIT 101", [digestToken(process.env.OWNER_PASSWORD_HASH || "")]);
            const [counts] = await db.query("SELECT (SELECT count(*)::int FROM agents WHERE active) AS authorized_agents,(SELECT count(*)::int FROM tokens WHERE kind IN ('api','access','refresh','code') AND revoked_at IS NULL AND expires_at>now()) AS unrevoked_credentials");
            return json({ sessions: sessions.slice(0, 100).map(s => ({ ...s, current: s.id === actor.token.id })), truncated: sessions.length > 100, counts, request_id: requestId });
        }
        if (request.method !== "POST" || u.pathname !== "/api/security/revoke")
            throw new AgentProblem(404, "NOT_FOUND", "安全管理操作不存在。");
        const input = revokeSchema.parse(await readAgentJson(request));
        // Shared across sessions: creating another session must not reset password-guess limits.
        await rateLimit("owner-security-reauth", 10, 900);
        if (!verifyPassword(input.password, process.env.OWNER_PASSWORD_HASH || ""))
            throw new AgentProblem(403, "REAUTHENTICATION_FAILED", "当前密码验证失败，未撤销任何访问。");
        const result = await db.transaction(async (tx) => {
            // Wait for preceding token mutations; this does not recall in-flight content writes.
            await tx.exec("LOCK TABLE agents, tokens IN SHARE ROW EXCLUSIVE MODE");
            const current = await tx.query("SELECT id FROM tokens WHERE id=$1 AND revoked_at IS NULL AND expires_at>now()", [actor.token.id]);
            if (!current.length)
                throw new AgentProblem(401, "UNAUTHENTICATED", "当前会话已失效，请重新登录。");
            let where: string, args: unknown[] = [];
            if (input.action === "session") {
                where = "kind='session' AND id=$1";
                args = [input.token_id];
            }
            else if (input.action === "other_sessions") {
                where = "kind='session' AND id<>$1";
                args = [actor.token.id];
            }
            else if (input.action === "agent_access") {
                where = "kind IN ('api','code','access','refresh')";
            }
            else
                where = "true";
            const rows = await tx.query(`UPDATE tokens SET revoked_at=now() WHERE revoked_at IS NULL AND (${where}) RETURNING id`, args);
            let disabled = 0;
            if (input.action === "agent_access" || input.action === "all_access")
                disabled = (await tx.query("UPDATE agents SET active=false WHERE active RETURNING id")).length;
            const signedOut = rows.some(row => row.id === actor.token.id);
            await event(tx, "security.access_revoked", "owner", actor.token.id, { action: input.action, revoked: rows.length, disabled_agents: disabled });
            return { revoked: rows.length, disabled_agents: disabled, signed_out: signedOut };
        });
        return json({ ...result, request_id: requestId }, 200, {
            "X-Request-Id": requestId, ...(result.signed_out ? { "Set-Cookie": sessionCookie("", true) } : {}),
        });
    }
    catch (error) {
        return problemResponse(error, requestId);
    }
}
