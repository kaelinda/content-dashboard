import { z } from "zod";
import { HubError } from "../domain.ts";
export class AgentError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AgentError";
  }
}
export const problemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.string(),
    detail: z.string(),
    request_id: z.string(),
    retryable: z.boolean(),
    errors: z
      .array(z.object({ pointer: z.string(), message: z.string() }))
      .optional(),
  })
  .passthrough();
export function problem(error: unknown, requestId: string) {
  let e: AgentError;
  if (error instanceof AgentError) e = error;
  else if (error instanceof z.ZodError)
    e = new AgentError(
      "VALIDATION_ERROR",
      "参数未通过校验；请修改指定字段，不要原样重试。",
      422,
      {
        errors: error.issues.map((i) => ({
          pointer:
            "/" +
            i.path
              .map(String)
              .map((s) => s.replaceAll("~", "~0").replaceAll("/", "~1"))
              .join("/"),
          message: i.message,
        })),
        recovery: { action: "correct_fields_then_retry" },
      },
    );
  else if (error instanceof HubError)
    e = new AgentError(
      (
        {
          401: "UNAUTHENTICATED",
          403: "FORBIDDEN",
          404: "NOT_FOUND",
          413: "PAYLOAD_TOO_LARGE",
          428: "PRECONDITION_REQUIRED",
          429: "RATE_LIMITED",
        } as Record<number, string>
      )[error.status] ?? "VALIDATION_ERROR",
      error.message,
      error.status,
      error.status === 429
        ? {
            retry_after_seconds: 60,
            recovery: { action: "wait_then_retry_same_key" },
          }
        : {},
    );
  else {
    // Do not leak SQL, tokens, request bodies or provider diagnostics to clients or logs.
    console.error(
      "Agent operation failed",
      requestId,
      error instanceof Error ? error.name : "UnknownError",
    );
    e = new AgentError(
      "INTERNAL_ERROR",
      "服务未完成此次请求；使用相同幂等键重试或联系所有者。",
      500,
      { recovery: { action: "retry_same_key" } },
    );
  }
  return {
    type:
      "urn:content-hub:problem:" + e.code.toLowerCase().replaceAll("_", "-"),
    title: e.code,
    status: e.status,
    code: e.code,
    detail: e.message,
    request_id: requestId,
    retryable: [429, 500, 502, 503, 504].includes(e.status),
    ...e.extra,
  };
}
export function problemResponse(error: unknown, requestId: string) {
  const p = problem(error, requestId);
  return Response.json(p, {
    status: p.status,
    headers: {
      "Content-Type": "application/problem+json",
      "Cache-Control": "no-store",
      "X-Request-ID": requestId,
      ...(p.status === 429 ? { "Retry-After": "60" } : {}),
      ...(p.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
    },
  });
}
