import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
const contexts = new AsyncLocalStorage<{
    id: string;
    principal?: string;
}>();
export const requestTraceId = () => contexts.getStore()?.id;
export function logPrincipal(value: string) { const c = contexts.getStore(); if (c && /^(?:owner|agent:[a-f0-9-]{36}|token:[a-f0-9-]{36})$/.test(value))
    c.principal = value; }
const uuid = /^[a-f0-9-]{36}$/;
const verbs = new Set(["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"]);
const roots = "auth|health|security|hub|search|contents|sources|assets|artifacts|publications|tokens|backup|demo|capabilities|files|projects|agents|changes|admin";
export function routeLabel(input: string): string {
    try {
        const path = new URL(input).pathname;
        if (path === "/mcp" || path === "/oauth/token")
            return path;
        const m = path.match(new RegExp(`^(/api(?:/v1)?)/(${roots})(.*)$`));
        if (!m || (m[3] && !m[3].startsWith("/")))
            return "unmatched";
        const tail = m[3].split("/").filter(Boolean);
        if (tail.length > 3)
            return "unmatched";
        const fixed = new Set(["login", "logout", "status", "live", "ready", "diagnostics", "revoke", "download", "versions", "blocks", "render", "url", "text", "upload", "tokens"]);
        return m[1] + "/" + m[2] + tail.map(v => "/" + (fixed.has(v) ? v : ":id")).join("");
    }
    catch {
        return "unmatched";
    }
}
export function responseLog(input: {
    requestId: string;
    method: string;
    url: string;
    status: number;
    durationMs: number;
    principal?: string;
}) {
    return {
        timestamp: new Date().toISOString(), event: "http.response_prepared",
        request_id: uuid.test(input.requestId) ? input.requestId : randomUUID(),
        ...(input.principal && /^(?:owner|agent:[a-f0-9-]{36}|token:[a-f0-9-]{36})$/.test(input.principal) ? { principal: input.principal } : {}),
        method: verbs.has(input.method) ? input.method : "OTHER",
        route: routeLabel(input.url),
        status: Number.isInteger(input.status) && input.status >= 100 && input.status <= 599 ? input.status : 500,
        duration_ms: Math.max(0, Math.round(input.durationMs)),
    };
}
/** Do not log headers, query, bodies, resource names, credentials or exception messages. */
export async function observeHttp(request: Request, handler: (r: Request) => Promise<Response>) {
    const start = performance.now();
    let status = 500;
    let requestId: string = randomUUID();
    const context: {
        id: string;
        principal?: string;
    } = { id: requestId };
    try {
        const response = await contexts.run(context, () => handler(request));
        status = response.status;
        const internalId = response.headers.get("X-Request-Id");
        if (internalId && uuid.test(internalId))
            requestId = internalId;
        response.headers.set("X-Request-Id", requestId);
        return response;
    }
    finally {
        try {
            console.info(JSON.stringify(responseLog({ requestId, method: request.method, url: request.url, principal: context.principal, status, durationMs: performance.now() - start })));
        }
        catch { /* logging failure must not turn an already committed write into an apparent failure */ }
    }
}
