import { readBytes } from "../http.ts";
import { AgentProblem } from "./problem.ts";

/** Reject text that PostgreSQL cannot preserve, before either transport writes. */
export function validateAgentText(value: unknown): void {
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === "string") {
      if (item.includes("\0") || !item.isWellFormed()) {
        throw new AgentProblem(
          422,
          "INVALID_TEXT",
          "文本不能包含 NUL 或不完整的 Unicode 字符。请修正后重试。",
          {
            recovery: { action: "correct_text_then_retry" },
          },
        );
      }
    } else if (Array.isArray(item)) {
      for (const field of item) pending.push(field);
    } else if (item && typeof item === "object") {
      for (const [key, field] of Object.entries(item)) pending.push(key, field);
    }
  }
}

export function mediaType(request: Request): string {
  return (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

/** JSON must be UTF-8, rather than silently replacing malformed input bytes. */
export async function readAgentJson(request: Request): Promise<unknown> {
  if (mediaType(request) !== "application/json") {
    throw new AgentProblem(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "请使用 application/json 请求体。",
    );
  }
  const bytes = await readBytes(request);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AgentProblem(
      400,
      "INVALID_ENCODING",
      "JSON 请求必须使用有效的 UTF-8 字节。",
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AgentProblem(
      400,
      "INVALID_JSON",
      "JSON 格式不正确，请修正后重试。",
    );
  }
}

export function validateQuery(url: URL, allowed?: readonly string[]): void {
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (seen.has(key))
      throw new AgentProblem(
        400,
        "DUPLICATE_PARAMETER",
        "查询参数不能重复：" + key,
      );
    if (allowed && !allowed.includes(key))
      throw new AgentProblem(
        400,
        "UNKNOWN_PARAMETER",
        "此操作不接受查询参数：" + key,
      );
    seen.add(key);
  }
}

export function uploadFilename(request: Request): string {
  try {
    return decodeURIComponent(request.headers.get("x-filename") ?? "");
  } catch {
    throw new AgentProblem(
      422,
      "INVALID_FILENAME",
      "X-Filename 的百分号编码无效，请使用编码后的文件名而不是路径。",
    );
  }
}
