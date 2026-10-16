/** Dependency-free domain model: also runs in Node's native TypeScript test runner. */
export const blockTypes = [
  "heading",
  "paragraph",
  "quote",
  "code",
  "callout",
  "image_prompt",
  "narration",
  "image",
] as const;
export type BlockType = (typeof blockTypes)[number];
export type Block = {
  id: string;
  type: BlockType;
  text: string;
  level?: number;
  lang?: string;
  variant?: string;
  attribution?: string;
  aspect?: string;
  duration_hint?: number;
  asset_id?: string;
  source_refs: string[];
};
export type ContentInput = {
  title: string;
  status: "draft" | "ready" | "archived";
  tags: string[];
  blocks: Block[];
  source_ids: string[];
  expected_version?: number;
};
export type Content = {
  id: string;
  title: string;
  status: ContentInput["status"];
  tags: string[];
  current_version: number;
  created_at: string;
  updated_at: string;
  excerpt?: string;
  source_count?: number;
};
export type ContentDetail = Content & {
  version: number;
  blocks: Block[];
  source_ids: string[];
};
export type Source = {
  id: string;
  title: string;
  original_url: string | null;
  markdown: string;
  sha256: string;
  trust_level: string;
  fetched_at: string;
  meta: Record<string, unknown>;
};
export type Asset = {
  id: string;
  sha256: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  name: string;
  created_at: string;
};
export type Artifact = {
  id: string;
  content_id: string;
  content_version: number;
  title: string;
  kind: string;
  variant: string;
  sha256: string;
  bytes: number;
  mime: string;
  recipe: Record<string, unknown>;
  created_at: string;
  stale?: boolean;
};
export type Publication = {
  id: string;
  artifact_id: string;
  platform: string;
  status: string;
  url: string | null;
  note: string;
  title: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};
export type HubEvent = {
  id: string;
  type: string;
  actor: string;
  subject_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};
export type HubData = {
  contents: Content[];
  sources: Source[];
  artifacts: Artifact[];
  publications: Publication[];
  assets: Asset[];
  events: HubEvent[];
  counts: {
    contents: number;
    sources: number;
    artifacts: number;
    published: number;
  };
  system: {
    database: string;
    storage: string;
    mcp: string;
    oauth_clients: { id: string; name: string }[];
  };
};
export class HubError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "HubError";
    this.status = status;
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HubError("请求必须是 JSON 对象");
  return value as Record<string, unknown>;
}
export function text(
  value: unknown,
  name: string,
  max = 200,
  required = true,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new HubError(`${name}不能为空，且不能超过 ${max} 字符`);
  return value;
}
export function choice<T extends string>(
  value: unknown,
  options: readonly T[],
  name: string,
): T {
  if (typeof value !== "string" || !options.includes(value as T))
    throw new HubError(`${name}不合法`);
  return value as T;
}
export function list(value: unknown, name: string, max = 100): string[] {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some((v) => typeof v !== "string" || v.length > 100)
  )
    throw new HubError(`${name}格式不正确`);
  return [...new Set(value as string[])];
}
export function validId(value: unknown): string {
  const id = text(value, "ID", 64);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new HubError("ID 不合法");
  return id;
}
export function parseContent(value: unknown): ContentInput {
  const v = object(value);
  const title = text(v.title, "标题");
  const status = choice(
    v.status ?? "draft",
    ["draft", "ready", "archived"] as const,
    "内容状态",
  );
  const tags = list(v.tags ?? [], "标签", 20);
  const source_ids = list(v.source_ids ?? [], "来源", 100).map(validId);
  if (!Array.isArray(v.blocks) || v.blocks.length > 300)
    throw new HubError("正文最多 300 个区块");
  const seen = new Set<string>();
  const blocks = v.blocks.map((raw) => {
    const b = object(raw);
    const id = validId(b.id);
    if (seen.has(id)) throw new HubError("区块 ID 不能重复");
    seen.add(id);
    const type = choice(b.type, blockTypes, "区块类型");
    const refs = list(b.source_refs ?? [], "引用").map(validId);
    if (refs.some((r) => !source_ids.includes(r)))
      throw new HubError("区块只能引用当前版本关联的来源");
    const result: Block = {
      id,
      type,
      text: text(b.text ?? "", "区块正文", 30000, false),
      source_refs: refs,
    };
    if (type === "heading") {
      if (![1, 2, 3].includes(Number(b.level ?? 2)))
        throw new HubError("标题层级不合法");
      result.level = Number(b.level ?? 2);
    }
    if (type === "code")
      result.lang = text(b.lang ?? "text", "代码语言", 30, false);
    if (type === "quote")
      result.attribution = text(b.attribution ?? "", "引用署名", 200, false);
    if (type === "callout")
      result.variant = choice(
        b.variant ?? "info",
        ["info", "warn", "tip"],
        "提示样式",
      );
    if (type === "image_prompt")
      result.aspect = choice(
        b.aspect ?? "3:4",
        ["3:4", "16:9", "1:1", "9:16"],
        "图片比例",
      );
    if (type === "narration") {
      const n = Number(b.duration_hint ?? 8);
      if (!Number.isFinite(n) || n < 1 || n > 600)
        throw new HubError("口播时长应在 1–600 秒");
      result.duration_hint = n;
    }
    if (type === "image") result.asset_id = validId(b.asset_id);
    return result;
  });
  if (blocks.reduce((sum, b) => sum + b.text.length, 0) > 500000)
    throw new HubError("正文总长超过 50 万字符");
  const result: ContentInput = { title, status, tags, blocks, source_ids };
  if (v.expected_version !== undefined) {
    const version = Number(v.expected_version);
    if (!Number.isInteger(version) || version < 1)
      throw new HubError("版本号无效");
    result.expected_version = version;
  }
  return result;
}
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function isStale(
  artifactVersion: number,
  currentVersion: number,
): boolean {
  return artifactVersion < currentVersion;
}
export function safeReturnTo(value: unknown): string {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !/[\\\r\n]/.test(value)
    ? value
    : "/";
}
/** Fail closed for IPv6 (including mapped IPv4). IPv4-only collection is deliberate. */
export function isPublicIPv4(address: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return false;
  const a = address.split(".").map(Number);
  if (a.some((n) => n > 255)) return false;
  const [x, y, z] = a;
  return !(
    x === 0 ||
    x === 10 ||
    x === 127 ||
    x >= 224 ||
    (x === 100 && y >= 64 && y <= 127) ||
    (x === 169 && y === 254) ||
    (x === 172 && y >= 16 && y <= 31) ||
    (x === 192 && (y === 168 || (y === 0 && (z === 0 || z === 2)))) ||
    (x === 198 && (y === 18 || y === 19 || (y === 51 && z === 100))) ||
    (x === 203 && y === 0 && z === 113)
  );
}
export function validateFetchUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new HubError("请输入有效的 HTTPS 链接");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hostname.endsWith(".local") ||
    url.hostname === "localhost"
  )
    throw new HubError("仅允许抓取公网 HTTPS 默认端口，不允许凭证或内网地址");
  return url;
}
export const renderOptions = [
  {
    kind: "html",
    variant: "web",
    label: "独立 HTML 页面",
    ext: "html",
    mime: "text/html; charset=utf-8",
  },
  {
    kind: "html",
    variant: "wechat",
    label: "公众号排版 HTML",
    ext: "html",
    mime: "text/html; charset=utf-8",
  },
  {
    kind: "markdown",
    variant: "general",
    label: "Markdown 文章",
    ext: "md",
    mime: "text/markdown; charset=utf-8",
  },
  {
    kind: "json",
    variant: "storyboard",
    label: "短视频分镜 JSON（非视频）",
    ext: "json",
    mime: "application/json; charset=utf-8",
  },
  {
    kind: "json",
    variant: "image-prompts",
    label: "配图提示词 JSON（非图片）",
    ext: "json",
    mime: "application/json; charset=utf-8",
  },
] as const;
export type RenderAsset = { mime: string; base64: string };
export function renderContent(
  content: Pick<ContentInput, "title" | "blocks">,
  kind: string,
  variant: string,
  assets: Record<string, RenderAsset> = {},
): { body: string; mime: string; ext: string } {
  const option = renderOptions.find(
    (o) => o.kind === kind && o.variant === variant,
  );
  if (!option) throw new HubError("不支持的渲染器");
  const e = escapeHtml;
  if (kind === "json")
    return {
      body: JSON.stringify(
        {
          schema_version: 1,
          title: content.title,
          type: variant,
          blocks: content.blocks.filter((b) =>
            variant === "image-prompts"
              ? b.type === "image_prompt"
              : [
                  "heading",
                  "paragraph",
                  "narration",
                  "image_prompt",
                  "code",
                ].includes(b.type),
          ),
        },
        null,
        2,
      ),
      mime: option.mime,
      ext: option.ext,
    };
  const article = content.blocks.filter(
    (b) => !["image_prompt", "narration"].includes(b.type),
  );
  if (kind === "markdown") {
    const body = article
      .map((b) => {
        switch (b.type) {
          case "heading":
            return "#".repeat(b.level ?? 2) + " " + b.text;
          case "code": {
            const runs = b.text.match(/`+/g) ?? [];
            const fence = "`".repeat(
              Math.max(3, ...runs.map((r) => r.length + 1)),
            );
            return `${fence}${(b.lang ?? "").replace(/[^a-zA-Z0-9_-]/g, "")}\n${b.text}\n${fence}`;
          }
          case "quote":
            return (
              b.text
                .split("\n")
                .map((s) => "> " + s)
                .join("\n") + (b.attribution ? "\n> — " + b.attribution : "")
            );
          case "callout":
            return "> " + b.text.replace(/\n/g, "\n> ");
          case "image":
            return `![${b.text.replace(/[\[\]\\]/g, "")}](${assets[b.asset_id!] ? `data:${assets[b.asset_id!].mime};base64,${assets[b.asset_id!].base64}` : `asset://${b.asset_id}`})`;
          default:
            return b.text;
        }
      })
      .join("\n\n");
    return {
      body: "# " + content.title + "\n\n" + body + "\n",
      mime: option.mime,
      ext: option.ext,
    };
  }
  const blocks = article
    .map((b) => {
      switch (b.type) {
        case "heading":
          return `<h${b.level ?? 2} style="font-size:24px;margin:32px 0 16px;line-height:1.5">${e(b.text)}</h${b.level ?? 2}>`;
        case "code":
          return `<pre style="overflow:auto;padding:20px;background:#172923;color:#e0efe8;border-radius:12px;white-space:pre-wrap"><code>${e(b.text)}</code></pre>`;
        case "quote":
          return `<blockquote style="border-left:3px solid #33866b;padding:8px 20px;margin:24px 0;color:#567265">${e(b.text).replace(/\n/g, "<br>")}${b.attribution ? `<footer>— ${e(b.attribution)}</footer>` : ""}</blockquote>`;
        case "callout":
          return `<aside style="padding:20px;background:#edf5ef;border-radius:12px;margin:24px 0">${e(b.text).replace(/\n/g, "<br>")}</aside>`;
        case "image": {
          const a = assets[b.asset_id!];
          return a
            ? `<figure style="margin:24px 0"><img src="data:${a.mime};base64,${a.base64}" alt="${e(b.text)}" style="max-width:100%;height:auto;border-radius:12px"><figcaption style="text-align:center;color:#758078;font-size:13px">${e(b.text)}</figcaption></figure>`
            : `<p>[图片：${e(b.text)}]</p>`;
        }
        default:
          return `<p style="margin:18px 0;line-height:1.9">${e(b.text).replace(/\n/g, "<br>")}</p>`;
      }
    })
    .join("\n");
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(content.title)}</title></head><body style="margin:0;padding:32px 20px;background:#fff;font-family:system-ui,-apple-system,sans-serif;color:#22332c"><article style="max-width:${variant === "wechat" ? "680" : "760"}px;margin:auto;font-size:16px"><h1 style="font-size:32px;line-height:1.45;letter-spacing:-.6px">${e(content.title)}</h1>${blocks}</article></body></html>`;
  return { body, mime: option.mime, ext: option.ext };
}
