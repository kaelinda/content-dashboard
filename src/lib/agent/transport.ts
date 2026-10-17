import { randomUUID } from "node:crypto";
import { readJson, readBytes, binary } from "../http.ts";
import { rateLimit } from "../auth.ts";
import { contracts, type Operation } from "./contracts.ts";
import { resolvePrincipal } from "./principal.ts";
import { execute, uploadFile, download, administer } from "./service.ts";
import { AgentProblem, problemResponse } from "./problem.ts";
export async function agentHttp(request: Request): Promise<Response> {
  const requestId = randomUUID();
  try {
    const url = new URL(request.url),
      path = url.pathname.replace(/^\/api\/v1\/?/, "");
    const p = await resolvePrincipal(request);
    await rateLimit("agent:" + p.id, 120, 60);
    const respond = (value: unknown, status = 200) =>
      Response.json(value, {
        status,
        headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
      });
    if (path === "files" && request.method === "POST") {
      const input = {
        project_id: url.searchParams.get("project_id"),
        name: request.headers.get("x-filename")
          ? decodeURIComponent(request.headers.get("x-filename")!)
          : "",
        mime: request.headers.get("content-type")?.split(";")[0],
        idempotency_key: request.headers.get("idempotency-key"),
      };
      return respond(
        await uploadFile(
          p,
          input,
          await readBytes(request, 20 * 1024 * 1024),
          requestId,
        ),
        201,
      );
    }
    const dl = path.match(
      /^(files|artifacts)\/([A-Za-z0-9_-]{1,64})\/download$/,
    );
    if (dl && request.method === "GET") {
      const f = await download(
        p,
        dl[1] === "files" ? "file" : "artifact",
        dl[2],
      );
      const r = binary(f.bytes, f.mime, f.name);
      r.headers.set("X-Request-Id", requestId);
      return r;
    }
    if (
      path === "admin" ||
      path === "projects" ||
      path === "agents" ||
      path.startsWith("agents/")
    ) {
      const data = await administer(
        p,
        request.method,
        path,
        request.method === "GET" ? {} : await readJson(request),
      );
      return respond(
        { data, meta: { request_id: requestId } },
        request.method === "POST" ? 201 : 200,
      );
    }
    for (const [name, contract] of Object.entries(contracts)) {
      const pattern = new RegExp(
        "^" +
          contract.path.slice(1).replace("{id}", "([A-Za-z0-9_-]{1,64})") +
          "$",
      );
      const match = path.match(pattern);
      if (!match) continue;
      if (request.method !== contract.method)
        throw new AgentProblem(
          405,
          "METHOD_NOT_ALLOWED",
          "此路径不支持该 HTTP 方法。",
        );
      let input: Record<string, unknown> = {};
      if (request.method === "GET") {
        for (const [key, value] of url.searchParams) {
          if (key in input)
            throw new AgentProblem(
              400,
              "DUPLICATE_PARAMETER",
              "参数不能重复：" + key,
            );
          input[key] =
            ["offset", "limit", "version"].includes(key) && /^\d+$/.test(value)
              ? Number(value)
              : value;
        }
      } else {
        if (
          !request.headers.get("content-type")?.startsWith("application/json")
        )
          throw new AgentProblem(
            415,
            "UNSUPPORTED_MEDIA_TYPE",
            "请使用 application/json 请求体。",
          );
        const body = await readJson(request);
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new AgentProblem(
            422,
            "INVALID_REQUEST",
            "请求体必须为 JSON 对象。",
          );
        input = body as Record<string, unknown>;
        const key = request.headers.get("idempotency-key");
        if (key && input.idempotency_key && key !== input.idempotency_key)
          throw new AgentProblem(
            400,
            "IDEMPOTENCY_KEY_MISMATCH",
            "请求头与正文的幂等键不一致。",
          );
        if (key) input.idempotency_key = key;
      }
      if (match[1]) {
        if (input.id !== undefined && input.id !== match[1])
          throw new AgentProblem(
            400,
            "RESOURCE_ID_MISMATCH",
            "正文/查询 ID 与路径不一致。",
          );
        input.id = match[1];
      }
      return respond(
        await execute(p, name as Operation, input, requestId),
        contract.method === "POST" ? 201 : 200,
      );
    }
    throw new AgentProblem(
      404,
      "NOT_FOUND",
      "API 路径不存在。请先读取 /openapi.json。",
    );
  } catch (e) {
    return problemResponse(e, requestId);
  }
}
