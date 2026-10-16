import { HubError } from "./domain.ts";
export async function readBytes(
  request: Request,
  limit = 1024 * 1024,
): Promise<Buffer> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > limit) throw new HubError("请求文件过大", 413);
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HubError("请求文件过大", 413);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export async function readJson(request: Request) {
  try {
    return JSON.parse((await readBytes(request)).toString("utf8")) as unknown;
  } catch (e) {
    if (e instanceof HubError) throw e;
    throw new HubError("JSON 格式不正确");
  }
}
export const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
export function errorResponse(error: unknown) {
  if (error instanceof HubError)
    return json({ error: error.message }, error.status);
  console.error(
    "Content Hub operation failed:",
    error instanceof Error ? error.name : "UnknownError",
  );
  return json({ error: "操作未完成，请检查服务器配置或稍后重试。" }, 500);
}
export function binary(bytes: Uint8Array, mime: string, name?: string) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      ...(name
        ? {
            "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name.replace(/[\r\n]/g, ""))}`,
          }
        : {}),
    },
  });
}
