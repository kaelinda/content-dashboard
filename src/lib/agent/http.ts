import { randomUUID } from "node:crypto";
import { authenticate, requireOrigin, rateLimit } from "../auth.ts";
import { readJson, readBytes, binary } from "../http.ts";
import { operations, idSchema } from "./contracts.ts";
import { execute, download } from "./service.ts";
import { admin } from "./admin.ts";
import { AgentError, problemResponse } from "./errors.ts";
export async function handleV1(request: Request): Promise<Response> {
  const requestId = randomUUID();
  try {
    const url = new URL(request.url),
      path = url.pathname.replace(/^\/api\/v1/, "") || "/";
    if (path === "/admin" || path.startsWith("/admin/"))
      return Response.json(
        {
          data: await admin(request, path.split("/").filter(Boolean).slice(1)),
        },
        { headers: { "Cache-Control": "no-store", "X-Request-ID": requestId } },
      );
    const actor = await authenticate(request, false, false, "v1");
    if (actor.owner && !["GET", "HEAD"].includes(request.method))
      requireOrigin(request);
    await rateLimit("agent-gateway:" + actor.token.id, 240, 60);
    const query: Record<string, unknown> = {};
    for (const [key, value] of url.searchParams) {
      if (key in query)
        throw new AgentError("VALIDATION_ERROR", "查询参数不能重复。", 422);
      query[key] = value;
    }
    const dl = /^\/(files|artifacts)\/([^/]+)\/download$/.exec(path);
    if (dl && request.method === "GET") {
      if (Object.keys(query).some((k) => k !== "project_id"))
        throw new AgentError(
          "VALIDATION_ERROR",
          "下载仅接受 project_id 参数。",
          422,
        );
      const project = idSchema.parse(query.project_id),
        id = idSchema.parse(dl[2]);
      const result = await download(
        actor,
        dl[1] === "files" ? "file" : "artifact",
        id,
        project,
        requestId,
      );
      const response = binary(
        result.bytes,
        "application/octet-stream",
        result.name,
      );
      response.headers.set("X-Request-ID", requestId);
      return response;
    }
    if (path === "/files" && request.method === "POST") {
      const key = request.headers.get("Idempotency-Key");
      if (!key)
        throw new AgentError(
          "IDEMPOTENCY_REQUIRED",
          "写入必须携带 Idempotency-Key。",
          428,
        );
      let name: string;
      try {
        name = decodeURIComponent(request.headers.get("X-Filename") || "");
      } catch {
        throw new AgentError(
          "VALIDATION_ERROR",
          "X-Filename 不是有效的 URI 编码文件名。",
          422,
        );
      }
      const result = await execute(
        actor,
        "file_upload",
        {
          ...query,
          idempotency_key: key,
          name,
          mime: (
            request.headers.get("Content-Type") || "application/octet-stream"
          )
            .split(";")[0]
            .trim(),
        },
        requestId,
        await readBytes(request, 10 * 1024 * 1024),
      );
      return Response.json(result, {
        status: 201,
        headers: { "Cache-Control": "no-store", "X-Request-ID": requestId },
      });
    }
    let matched = false;
    for (const op of operations) {
      const re = new RegExp("^" + op.path.replace("{id}", "([^/]+)") + "$"),
        match = re.exec(path);
      if (!match) continue;
      matched = true;
      if (op.method !== request.method) continue;
      const body = op.write ? await readJson(request) : {};
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new AgentError(
          "VALIDATION_ERROR",
          "请求体必须是 JSON 对象。",
          422,
        );
      const values: Record<string, unknown> = { ...query, ...body };
      for (const field of ["limit", "version"])
        if (typeof values[field] === "string")
          values[field] = values[field] === "" ? NaN : Number(values[field]);
      if (match[1]) {
        if (values.id !== undefined && values.id !== match[1])
          throw new AgentError(
            "VALIDATION_ERROR",
            "路径 ID 与请求体 ID 不一致。",
            422,
          );
        values.id = match[1];
      }
      if (op.write) {
        const key = request.headers.get("Idempotency-Key");
        if (!key)
          throw new AgentError(
            "IDEMPOTENCY_REQUIRED",
            "写入必须携带 Idempotency-Key；超时后原样重试。",
            428,
          );
        if (
          values.idempotency_key !== undefined &&
          values.idempotency_key !== key
        )
          throw new AgentError(
            "VALIDATION_ERROR",
            "请求体幂等键与请求头不一致。",
            422,
          );
        values.idempotency_key = key;
      }
      const result = await execute(actor, op.name, values, requestId);
      return Response.json(result, {
        status: op.method === "POST" ? 201 : 200,
        headers: { "Cache-Control": "no-store", "X-Request-ID": requestId },
      });
    }
    throw new AgentError(
      matched ? "METHOD_NOT_ALLOWED" : "NOT_FOUND",
      matched ? "此路径不支持该 HTTP 方法。" : "接口不存在。",
      matched ? 405 : 404,
    );
  } catch (e) {
    return problemResponse(e, requestId);
  }
}
