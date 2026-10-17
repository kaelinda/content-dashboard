import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { HubError } from "../domain.ts";
export class AgentProblem extends HubError {
  code: string;
  context: Record<string, unknown>;
  constructor(
    status: number,
    code: string,
    detail: string,
    context: Record<string, unknown> = {},
  ) {
    super(detail, status);
    this.code = code;
    this.context = context;
  }
}
export function problem(error: unknown, requestId: string = randomUUID()) {
  if (error instanceof ZodError)
    return {
      type: "urn:content-hub:problem:validation-error",
      title: "请求字段无效",
      status: 422,
      code: "VALIDATION_ERROR",
      detail: "按 errors 中的字段位置修正参数后重试。",
      retryable: false,
      errors: error.issues.map((i) => ({
        path: i.path.join("."),
        code: i.code,
        message: i.message,
      })),
      request_id: requestId,
    };
  const status = error instanceof HubError ? error.status : 500;
  const codes: Record<number, string> = {
    400: "INVALID_REQUEST",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    413: "PAYLOAD_TOO_LARGE",
    415: "UNSUPPORTED_MEDIA_TYPE",
    422: "VALIDATION_ERROR",
    428: "PRECONDITION_REQUIRED",
    429: "RATE_LIMITED",
    503: "UNAVAILABLE",
  };
  const code =
    error instanceof AgentProblem
      ? error.code
      : (codes[status] ?? "INTERNAL_ERROR");
  return {
    type: "urn:content-hub:problem:" + code.toLowerCase().replaceAll("_", "-"),
    title: code,
    status,
    code,
    detail:
      error instanceof HubError
        ? error.message
        : "服务暂时无法完成操作。写请求重试必须保留原幂等键。",
    retryable: [429, 500, 502, 503, 504].includes(status),
    request_id: requestId,
    ...(status === 429 ? { retry_after_seconds: 60 } : {}),
    ...(error instanceof AgentProblem ? error.context : {}),
  };
}
export function problemResponse(error: unknown, requestId?: string) {
  const data = problem(error, requestId);
  return Response.json(data, {
    status: data.status,
    headers: {
      "Content-Type": "application/problem+json",
      "Cache-Control": "no-store",
      "X-Request-Id": data.request_id,
      ...(data.status === 429 ? { "Retry-After": "60" } : {}),
    },
  });
}
