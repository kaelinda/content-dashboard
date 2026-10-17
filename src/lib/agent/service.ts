import { requestTraceId } from "../observability.ts";
import { validateAgentText } from "./request.ts";
import { outputSchema } from "./outputs.ts";
import { randomUUID, createHash } from "node:crypto";
import { database, type Database } from "../db.ts";
import { issueToken } from "../auth.ts";
import {
  saveContent,
  getContent,
  saveSource,
  event,
  recordChange,
} from "../repository.ts";
import { getBlob, putBlob } from "../storage.ts";
import { type Block, type ContentDetail } from "../domain.ts";
import {
  contracts,
  type Operation,
  agentGrantSchema,
  projectSchema,
  fileQuerySchema,
} from "./contracts.ts";
import {
  requireProject,
  requireScope,
  SCOPES,
  type Principal,
} from "./principal.ts";
import { AgentProblem, problem } from "./problem.ts";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const tableFor = {
  content: "contents",
  source: "sources",
  file: "agent_files",
  artifact: "artifacts",
} as const;
export async function resource(
  db: Database,
  p: Principal,
  kind: keyof typeof tableFor,
  id: string,
) {
  const sql =
    kind === "artifact"
      ? "SELECT a.*,c.project_id,c.current_version FROM artifacts a JOIN contents c ON c.id=a.content_id WHERE a.id=$1"
      : `SELECT * FROM ${tableFor[kind]} WHERE id=$1`;
  const [row] = await db.query(sql, [id]);
  if (!row || !p.projects.includes(String(row.project_id)))
    throw new AgentProblem(
      404,
      "NOT_FOUND",
      "资源不存在或不在当前授权范围内。",
    );
  return row;
}
export async function idempotent<T>(
  db: Database,
  p: Principal,
  key: string,
  op: string,
  input: unknown,
  action: (tx: Database) => Promise<T>,
) {
  const fingerprint = hash(canonical({ op, input }));
  return db.transaction(async (tx) => {
    // INSERT waits for a competing key to commit. Result and domain writes share one transaction.
    await tx.query(
      "INSERT INTO agent_idempotency(principal_id,key,request_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [p.id, key, fingerprint],
    );
    const [row] = await tx.query<{ request_hash: string; response: T | null }>(
      "SELECT request_hash,response FROM agent_idempotency WHERE principal_id=$1 AND key=$2 FOR UPDATE",
      [p.id, key],
    );
    if (row.request_hash !== fingerprint)
      throw new AgentProblem(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "该幂等键已用于其他参数。原请求重试请保留原参数；新操作请使用新键。",
      );
    if (row.response !== null) return { data: row.response, replayed: true };
    const data = await action(tx);
    await tx.query(
      "UPDATE agent_idempotency SET response=$3::jsonb WHERE principal_id=$1 AND key=$2",
      [p.id, key, JSON.stringify(data)],
    );
    return { data, replayed: false };
  });
}
function cut(text: string, offset: number, limit: number) {
  const points = Array.from(text);
  const end = Math.min(points.length, offset + limit);
  return {
    text: points.slice(offset, end).join(""),
    range: {
      unit: "unicode_code_points",
      offset,
      limit,
      total: points.length,
      next_offset: end < points.length ? end : null,
      truncated: end < points.length,
    },
  };
}
function markdown(c: ContentDetail) {
  return c.blocks
    .map((b) => {
      if (b.type === "heading") return "#".repeat(b.level ?? 2) + " " + b.text;
      if (b.type === "quote")
        return (
          b.text
            .split("\n")
            .map((l) => "> " + l)
            .join("\n") + (b.attribution ? "\n— " + b.attribution : "")
        );
      if (b.type === "code") {
        const fence = "`".repeat(
          Math.max(3, ...(b.text.match(/`+/g) ?? []).map((s) => s.length + 1)),
        );
        return `${fence}${b.lang ?? "text"}\n${b.text}\n${fence}`;
      }
      if (b.type === "image") return `![${b.text}](asset://${b.asset_id})`;
      if (b.type === "image_prompt" || b.type === "narration")
        return `[${b.type}]\n${b.text}`;
      return b.text;
    })
    .join("\n\n");
}
function importedBlocks(text: string): Block[] {
  // Preserve all input characters, including unsupported Markdown syntax. No lossy HTML conversion.
  const chunks: string[] = [];
  let chunk = "";
  for (const character of text) {
    if (chunk.length + character.length > 28000) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  chunks.push(chunk);
  return chunks.map((text) => ({
    id: randomUUID(),
    type: "paragraph",
    text,
    source_refs: [],
  }));
}
const receipt = (c: ContentDetail) => ({
  id: c.id,
  content_id: c.id,
  version: c.version,
  status: c.status,
  block_ids: c.blocks.map((b) => b.id),
});
export function allowedOperations(p: Principal) {
  return (Object.keys(contracts) as Operation[]).filter(
    (k) =>
      (!contracts[k].scope || p.scopes.includes(contracts[k].scope)) &&
      (k !== "artifact_register" ||
        (p.scopes.includes("contents:read") &&
          p.scopes.includes("files:read"))),
  );
}

export async function execute(
  p: Principal,
  op: Operation,
  raw: unknown,
  requestId = randomUUID(),
) {
  const started = Date.now();
  let replayed = false;
  let status = contracts[op].method === "POST" ? 201 : 200,
    code: string | null = null;
  try {
    const contract = contracts[op];
    if (contract.scope) requireScope(p, contract.scope);
    validateAgentText(raw);
    const input = contract.schema.parse(raw);
    const db = await database();
    const data = input as Record<string, unknown>;
    if (data.project_id) requireProject(p, String(data.project_id));
    // Re-authorize BEFORE looking up replay receipts, including after a grant was narrowed.
    if (op.startsWith("content_") && data.id)
      await resource(db, p, "content", String(data.id));
    if (op === "source_get") await resource(db, p, "source", String(data.id));
    if (op === "artifact_get")
      await resource(db, p, "artifact", String(data.id));
    if (op === "artifact_register") {
      requireScope(p, "contents:read");
      requireScope(p, "files:read");
      const content = await resource(db, p, "content", String(data.content_id));
      const file = await resource(db, p, "file", String(data.file_id));
      if (content.project_id !== file.project_id)
        throw new AgentProblem(
          422,
          "CROSS_PROJECT_REFERENCE",
          "产物文件必须与正文属于同一项目。",
        );
    }
    const action = async (tx: Database) => {
      const result = JSON.parse(
        JSON.stringify(await perform(tx, p, op, data)),
      ) as Record<string, unknown>;
      if (
        !outputSchema(op).safeParse({
          data: result,
          meta: {
            request_id: requestId,
            replayed: false,
            committed: contract.method !== "GET",
          },
        }).success
      )
        throw new AgentProblem(
          500,
          "OUTPUT_CONTRACT_VIOLATION",
          "服务端响应校验失败；写入事务已回滚，请保留幂等键重试。",
        );
      return result;
    };
    const result =
      typeof data.idempotency_key === "string"
        ? await idempotent(db, p, data.idempotency_key, op, data, action)
        : { data: await action(db), replayed: false };
    replayed = result.replayed;
    const output = {
      data: result.data,
      meta: {
        request_id: requestId,
        replayed: result.replayed,
        committed: contract.method !== "GET",
      },
    };
    // Normalize database Date values once; both transports expose the same JSON contract.
    outputSchema(op).parse(JSON.parse(JSON.stringify(output)));
    return JSON.parse(JSON.stringify(output)) as typeof output;
  } catch (e) {
    const detail = problem(e, requestId);
    status = detail.status;
    code = detail.code;
    throw e;
  } finally {
    // Whitelisted operation fields only, never task input, names, secrets or error messages.
    try { console.info(JSON.stringify({ timestamp:new Date().toISOString(), event:"agent.operation", request_id:requestId, parent_request_id:requestTraceId(), operation:op, status, code, replayed, duration_ms:Math.max(0,Date.now()-started) })); } catch { /* logging cannot change a committed outcome */ }
    // No bodies, documents, bearer tokens or external credentials are written to access logs.
    try {
      await (
        await database()
      ).query(
        "INSERT INTO agent_requests(request_id,principal_id,operation,status,code,duration_ms) VALUES($1,$2,$3,$4,$5,$6)",
        [requestId, p.id, op, status, code, Date.now() - started],
      );
    } catch {
      console.error("Agent audit log could not be recorded", requestId);
    }
  }
}
async function perform(
  db: Database,
  p: Principal,
  op: Operation,
  v: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (op === "hub_capabilities")
    return {
      api_version: "1.1.0",
      principal: { id: p.id, name: p.name, legacy_token: p.legacy },
      projects: await db.query(
        "SELECT id,name FROM projects WHERE id=ANY($1::text[]) ORDER BY id",
        [p.projects],
      ),
      scopes: p.scopes,
      operations: allowedOperations(p),
      limits: {
        file_bytes: 20 * 1024 * 1024,
        body_bytes: 1024 * 1024,
        markdown_code_points_per_read: 16000,
        blocks_per_read: 20,
        search_page: 50,
      },
      idempotency: {
        required_for_writes: true,
        retention: "indefinite_until_operator_cleanup",
        scope: "stable_principal",
        cross_transport: true,
      },
      supported: {
        mcp_write: !p.legacy && p.scopes.some((s) => s.endsWith(":write")),
        external_file_registration: true,
        automatic_publishing: false,
        background_jobs: false,
        webhooks: false,
      },
      links: {
        openapi: "/openapi.json",
        docs: "/docs/agents",
        upload: "/api/v1/files",
      },
    };
  if (op === "hub_search") {
    const fingerprint = hash(
      canonical({
        q: v.query,
        project: v.project_id,
        scopes: p.scopes.slice().sort(),
      }),
    );
    let after = "";
    if (v.cursor) {
      try {
        const c = JSON.parse(
          Buffer.from(String(v.cursor), "base64url").toString(),
        );
        if (c.fingerprint !== fingerprint || typeof c.after !== "string")
          throw 0;
        after = c.after;
      } catch {
        throw new AgentProblem(
          400,
          "INVALID_CURSOR",
          "搜索条件或授权变化后请从第一页开始。",
        );
      }
    }
    const pattern = "%" + String(v.query).replace(/[\\%_]/g, "\\$&") + "%";
    const rows = await db.query<{ key: string; [key: string]: unknown }>(
      `SELECT * FROM (
      SELECT 'content:'||id AS key,'content' AS kind,id,title,substring(search_text,1,180) AS excerpt,current_version AS version FROM contents WHERE project_id=$1 AND search_text ILIKE $2 AND $3
      UNION ALL SELECT 'source:'||id,'source',id,title,substring(markdown,1,180),NULL::integer FROM sources WHERE project_id=$1 AND (title||markdown) ILIKE $2 AND $4
      UNION ALL SELECT 'artifact:'||a.id,'artifact',a.id,a.title,a.kind||' / '||a.variant,a.content_version FROM artifacts a JOIN contents c ON c.id=a.content_id WHERE c.project_id=$1 AND a.title ILIKE $2 AND $5
    ) r WHERE key>$6 ORDER BY key LIMIT $7`,
      [
        v.project_id,
        pattern,
        p.scopes.includes("contents:read"),
        p.scopes.includes("sources:read"),
        p.scopes.includes("artifacts:read"),
        after,
        Number(v.limit) + 1,
      ],
    );
    const more = rows.length > Number(v.limit);
    const items = rows.slice(0, Number(v.limit));
    return {
      items,
      has_more: more,
      next_cursor: more
        ? Buffer.from(
            JSON.stringify({ fingerprint, after: items.at(-1)!.key }),
          ).toString("base64url")
        : null,
      trust: "untrusted_reference_material",
      ordering: "stable_resource_id; use changes for lossless incremental sync",
    };
  }
  if (op === "source_save") {
    if (v.original_url) {
      const url = new URL(String(v.original_url));
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new AgentProblem(
          422,
          "INVALID_URL",
          "仅接受不含凭证的 HTTP(S) 来源元数据。",
        );
    }
    const source = await saveSource(
      Buffer.from(String(v.markdown)),
      {
        title: String(v.title),
        markdown: String(v.markdown),
        url: v.original_url as string | undefined,
        mime: "text/markdown",
        trust: "low",
        meta: {
          import: "agent",
          verification: "unverified",
          principal_id: p.id,
        },
      },
      p.id,
      { db, projectId: String(v.project_id) },
    );
    return {
      id: source.id,
      source_id: source.id,
      snapshot_sha256: source.sha256,
      trust: "unverified",
      project_id: v.project_id,
    };
  }
  if (op === "source_get") {
    const s = await resource(db, p, "source", String(v.id));
    return {
      id: s.id,
      title: s.title,
      project_id: s.project_id,
      snapshot_sha256: s.sha256,
      original_url: s.original_url,
      trust: "untrusted_reference_material",
      view: v.view,
      ...(v.view === "summary"
        ? { excerpt: cut(String(s.markdown), 0, 240).text }
        : cut(String(s.markdown), Number(v.offset), Number(v.limit))),
    };
  }
  if (op === "content_create") {
    const blocks =
      v.markdown !== undefined
        ? importedBlocks(String(v.markdown))
        : (v.blocks as Block[]).map((b) => ({
            ...b,
            id: b.id ?? randomUUID(),
          }));
    const content = await saveContent(
      { ...v, status: "draft", blocks },
      undefined,
      p.id,
      { db, projectId: String(v.project_id) },
    );
    return {
      ...receipt(content),
      project_id: v.project_id,
      warnings:
        v.markdown !== undefined
          ? [
              "Markdown 保留文本存为段落，不解析标题/表格语义；超长文本会分块，阅读视图在块间加空行。需要原始字节请同时保存 source/file，需要精确语义请传 blocks。",
            ]
          : [],
    };
  }
  if (op === "content_get") {
    const r = await resource(db, p, "content", String(v.id));
    const c = await getContent(
      String(v.id),
      v.version as number | undefined,
      db,
    );
    const common = {
      id: c.id,
      title: c.title,
      project_id: r.project_id,
      version: c.version,
      current_version: c.current_version,
      status: c.status,
      view: v.view,
      trust: "untrusted_reference_material",
    };
    if (v.view === "summary")
      return {
        ...common,
        excerpt: cut(c.blocks.map((b) => b.text).join("\n"), 0, 240).text,
        block_count: c.blocks.length,
        source_count: c.source_ids.length,
      };
    if (v.view === "markdown")
      return {
        ...common,
        ...cut(markdown(c), Number(v.offset), Number(v.limit)),
        note: "这是阅读视图；编辑时使用 blocks 与 expected_version。",
      };
    const offset = Number(v.offset),
      limit = Math.min(Number(v.limit), 20);
    const blocks: Block[] = [];
    let chars = 0;
    for (const b of c.blocks.slice(offset, offset + limit)) {
      if (blocks.length && chars + b.text.length > 64000) break;
      blocks.push(b);
      chars += b.text.length;
    }
    const end = Math.min(c.blocks.length, offset + blocks.length);
    return {
      ...common,
      source_ids: c.source_ids,
      blocks,
      range: {
        unit: "blocks",
        offset,
        limit,
        total: c.blocks.length,
        next_offset: end < c.blocks.length ? end : null,
        truncated: end < c.blocks.length,
      },
    };
  }
  if (op === "content_update_blocks") {
    const row = await resource(db, p, "content", String(v.id));
    const c = await getContent(String(v.id), undefined, db);
    if (c.version !== v.expected_version)
      throw new AgentProblem(
        409,
        "VERSION_CONFLICT",
        "此次修改未写入。先读取当前版本并比较差异，再基于新内容提交。",
        {
          expected_version: v.expected_version,
          current_version: c.version,
          recovery: { action: "read_compare_then_retry" },
        },
      );
    const blocks = [...c.blocks];
    for (const change of v.operations as {
      op: string;
      block_id?: string;
      block?: Block;
    }[]) {
      if (change.op === "append") {
        blocks.push({ ...change.block!, id: change.block!.id ?? randomUUID() });
        continue;
      }
      const i = blocks.findIndex((b) => b.id === change.block_id);
      if (i < 0)
        throw new AgentProblem(
          422,
          "BLOCK_NOT_FOUND",
          "找不到指定 block_id；请先读取相同版本的 blocks。",
        );
      if (change.op === "remove") blocks.splice(i, 1);
      else {
        if (change.block?.id && change.block.id !== change.block_id)
          throw new AgentProblem(
            422,
            "BLOCK_ID_MISMATCH",
            "replace 不能改变区块的稳定 ID。",
          );
        blocks[i] = { ...change.block!, id: change.block_id! };
      }
    }
    // saveContent acquires the content row lock and checks the version again in the same transaction.
    try {
      const saved = await saveContent(
        {
          ...c,
          blocks,
          title: v.title ?? c.title,
          expected_version: v.expected_version,
        },
        c.id,
        p.id,
        { db, projectId: String(row.project_id) },
      );
      return receipt(saved);
    } catch (e) {
      if (e && typeof e === "object" && "status" in e && e.status === 409)
        throw new AgentProblem(
          409,
          "VERSION_CONFLICT",
          "并发修改已提交，请读取新版本后比较差异。",
          {
            expected_version: v.expected_version,
            recovery: { action: "read_compare_then_retry" },
          },
        );
      throw e;
    }
  }
  if (op === "artifact_register") {
    const c = await getContent(
      String(v.content_id),
      Number(v.content_version),
      db,
    );
    const file = await resource(db, p, "file", String(v.file_id));
    const kinds: Record<string, string[]> = {
      html: ["text/html"],
      markdown: ["text/markdown"],
      image: ["image/png", "image/jpeg", "image/webp"],
      video: ["video/mp4", "video/webm"],
      json: ["application/json"],
      text: ["text/plain"],
      pdf: ["application/pdf"],
    };
    if (!kinds[String(v.kind)].includes(String(file.mime)))
      throw new AgentProblem(
        422,
        "MIME_KIND_MISMATCH",
        "产物类型与已验证上传文件的 MIME 不一致。",
      );
    const ext: Record<string, string> = {
      "text/html": "html",
      "text/markdown": "md",
      "text/plain": "txt",
      "application/json": "json",
      "application/pdf": "pdf",
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "video/mp4": "mp4",
      "video/webm": "webm",
    };
    const recipe = {
      producer_claim: v.recipe,
      file_id: file.id,
      principal_id: p.id,
      import: "external_file",
      ext: ext[String(file.mime)],
    };
    const rows = await db.query(
      "INSERT INTO artifacts(id,content_id,content_version,title,kind,variant,sha256,bytes,mime,recipe) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT DO NOTHING RETURNING *",
      [
        randomUUID(),
        c.id,
        c.version,
        c.title,
        v.kind,
        v.variant,
        file.sha256,
        file.bytes,
        file.mime,
        JSON.stringify(recipe),
      ],
    );
    const a =
      rows[0] ??
      (
        await db.query(
          "SELECT * FROM artifacts WHERE content_id=$1 AND content_version=$2 AND kind=$3 AND variant=$4 AND sha256=$5",
          [c.id, c.version, v.kind, v.variant, file.sha256],
        )
      )[0];
    await event(db, "artifact.registered", p.id, String(a.id), {
      version: c.version,
    });
    return {
      id: a.id,
      artifact_id: a.id,
      content_id: c.id,
      content_version: c.version,
      sha256: a.sha256,
      bytes: a.bytes,
      mime: a.mime,
      immutable: true,
      deduplicated: !rows[0],
    };
  }
  if (op === "artifact_get") {
    const a = await resource(db, p, "artifact", String(v.id));
    return {
      ...a,
      stale: Number(a.content_version) < Number(a.current_version),
      download_path: "/api/v1/artifacts/" + a.id + "/download",
      trust: "untrusted_file_do_not_execute",
    };
  }
  if (op === "hub_changes") {
    const [clock] = await db.query<{ value: string }>(
      "SELECT value FROM agent_change_clock WHERE singleton=true",
    );
    if (BigInt(String(v.after)) > BigInt(clock.value))
      throw new AgentProblem(
        400,
        "INVALID_CURSOR",
        "游标超出当前数据集。恢复备份或切换服务后请重新全量同步。",
      );
    const kinds = [
      ...["content", "source", "artifact", "file"].filter((k) =>
        p.scopes.includes(
          (
            {
              content: "contents:read",
              source: "sources:read",
              artifact: "artifacts:read",
              file: "files:read",
            } as Record<string, string>
          )[k],
        ),
      ),
      ...(p.scopes.includes("files:read") ? ["asset"] : []),
    ];
    const rows = await db.query<{ id: string }>(
      "SELECT id::text,kind,resource_id,version,operation,actor,created_at FROM agent_changes WHERE project_id=$1 AND id>$2::bigint AND id<=$3::bigint AND kind=ANY($4::text[]) ORDER BY id LIMIT $5",
      [v.project_id, v.after, clock.value, kinds, Number(v.limit) + 1],
    );
    const more = rows.length > Number(v.limit),
      items = rows.slice(0, Number(v.limit));
    return {
      items,
      has_more: more,
      next_cursor: more ? items.at(-1)!.id : String(clock.value),
      high_watermark: String(clock.value),
      delivery: "at_least_once; checkpoints are caller-owned",
    };
  }
  throw new AgentProblem(404, "UNKNOWN_OPERATION", "未找到此操作。");
}

function validateFile(bytes: Buffer, mime: string) {
  let valid = false;
  if (mime.startsWith("text/") || mime === "application/json") {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (mime === "application/json") JSON.parse(text);
      valid = !text.includes("\0");
    } catch {
      /* rejected below */
    }
  } else if (mime === "application/pdf")
    valid = bytes.subarray(0, 5).toString() === "%PDF-";
  else if (mime === "image/png")
    valid = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  else if (mime === "image/jpeg")
    valid = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  else if (mime === "image/webp")
    valid =
      bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.subarray(8, 12).toString() === "WEBP";
  else if (mime === "video/mp4")
    valid = bytes.subarray(4, 8).toString() === "ftyp";
  else if (mime === "video/webm")
    valid = bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
  if (!valid)
    throw new AgentProblem(
      415,
      "FILE_FORMAT_MISMATCH",
      "文件字节与声明格式不一致。上传原始文件，而不是本地路径或 Base64 文本。",
    );
}
export async function uploadFile(
  p: Principal,
  input: unknown,
  bytes: Buffer,
  requestId = randomUUID(),
) {
  requireScope(p, "files:write");
  validateAgentText(input);
  const v = fileQuerySchema.parse(input);
  requireProject(p, v.project_id);
  if (!bytes.length || bytes.length > 20 * 1024 * 1024)
    throw new AgentProblem(
      413,
      "PAYLOAD_TOO_LARGE",
      "文件不能为空且最大 20 MiB。",
    );
  if (/[\x00-\x1f/\\]/.test(v.name))
    throw new AgentProblem(
      422,
      "INVALID_FILENAME",
      "请提供文件名，不要提供本地路径。",
    );
  validateFile(bytes, v.mime);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const r = await idempotent(
    await database(),
    p,
    v.idempotency_key,
    "file_upload",
    { ...v, sha256 },
    async (tx) => {
      await putBlob(bytes);
      const inserted = await tx.query(
        "INSERT INTO agent_files(id,project_id,name,mime,bytes,sha256,actor) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING *",
        [
          randomUUID(),
          v.project_id,
          v.name,
          v.mime,
          bytes.length,
          sha256,
          p.id,
        ],
      );
      const file =
        inserted[0] ??
        (
          await tx.query(
            "SELECT * FROM agent_files WHERE project_id=$1 AND sha256=$2 AND name=$3 AND mime=$4",
            [v.project_id, sha256, v.name, v.mime],
          )
        )[0];
      await recordChange(
        tx,
        v.project_id,
        "file",
        String(file.id),
        "file.uploaded",
        p.id,
      );
      return {
        id: file.id,
        file_id: file.id,
        project_id: v.project_id,
        bytes: bytes.length,
        sha256,
        mime: v.mime,
        name: v.name,
        verification: "signature_or_utf8_only; not_malware_scanned",
      };
    },
  );
  return {
    data: r.data,
    meta: { request_id: requestId, replayed: r.replayed, committed: true },
  };
}
export async function download(
  p: Principal,
  kind: "file" | "artifact",
  id: string,
) {
  requireScope(p, kind === "file" ? "files:read" : "artifacts:read");
  const row = await resource(await database(), p, kind, id);
  return {
    bytes: await getBlob(String(row.sha256)),
    mime: String(row.mime),
    name:
      String(row.name ?? row.title) +
      (kind === "artifact"
        ? "." + String((row.recipe as Record<string, unknown>).ext ?? "bin")
        : ""),
  };
}
export async function administer(
  p: Principal,
  method: string,
  path: string,
  input: unknown,
) {
  if (!p.owner)
    throw new AgentProblem(
      403,
      "OWNER_REQUIRED",
      "只有已登录的所有者可以管理 Agent 授权。",
    );
  validateAgentText(input);
  const db = await database();
  if (method === "GET" && path === "admin")
    return {
      agents: await db.query("SELECT * FROM agents ORDER BY created_at DESC"),
      projects: await db.query("SELECT * FROM projects ORDER BY created_at"),
      requests: await db.query(
        "SELECT * FROM agent_requests ORDER BY created_at DESC LIMIT 30",
      ),
      scopes: SCOPES,
    };
  if (method === "POST" && path === "projects") {
    const v = projectSchema.parse(input);
    return (
      await db.query(
        "INSERT INTO projects(id,name) VALUES($1,$2) RETURNING *",
        [randomUUID(), v.name],
      )
    )[0];
  }
  if (method === "POST" && path === "agents") {
    const v = agentGrantSchema.parse(input);
    for (const id of v.project_ids) requireProject(p, id);
    return (
      await db.query(
        "INSERT INTO agents(id,name,scopes,project_ids) VALUES($1,$2,$3,$4) RETURNING *",
        [
          randomUUID(),
          v.name,
          [...new Set(v.scopes)],
          [...new Set(v.project_ids)],
        ],
      )
    )[0];
  }
  if (method === "POST" && /^agents\/[A-Za-z0-9_-]+\/tokens$/.test(path)) {
    const id = path.split("/")[1];
    const [a] = await db.query<{
      name: string;
      scopes: string[];
      active: boolean;
    }>("SELECT * FROM agents WHERE id=$1", [id]);
    if (!a?.active)
      throw new AgentProblem(404, "NOT_FOUND", "Agent 不存在或已停用。");
    const token = await issueToken("api", a.name, a.scopes, 90 * 86400, {
      agent_id: id,
    });
    return { ...token, agent_id: id, expires_in_days: 90 };
  }
  if (method === "PATCH" && /^agents\/[A-Za-z0-9_-]+$/.test(path)) {
    if (
      !input ||
      typeof input !== "object" ||
      !("active" in input) ||
      typeof input.active !== "boolean" ||
      Object.keys(input).length !== 1
    )
      throw new AgentProblem(
        422,
        "INVALID_REQUEST",
        "仅接受 active 布尔字段。",
      );
    const rows = await db.query(
      "UPDATE agents SET active=$2 WHERE id=$1 RETURNING *",
      [path.split("/")[1], input.active],
    );
    if (!rows.length)
      throw new AgentProblem(404, "NOT_FOUND", "Agent 不存在。");
    return rows[0];
  }
  throw new AgentProblem(404, "NOT_FOUND", "管理操作不存在。");
}
