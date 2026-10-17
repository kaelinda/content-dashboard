import { randomUUID } from "node:crypto";
import { database, type Database } from "../db.ts";
import type { Actor } from "../auth.ts";
import {
  getContent,
  saveContent,
  saveSource,
  saveAsset,
  event,
} from "../repository.ts";
import { type Block, type ContentInput } from "../domain.ts";
import { putBlob, getBlob, sha256 } from "../storage.ts";
import {
  operations,
  uploadOperation,
  permissions,
  canUse,
  type Operation,
} from "./contracts.ts";
import { AgentError, problem } from "./errors.ts";
import { lockProject, requestContext, resourceProject } from "./context.ts";

// Every dynamic argument below is validated by the operation's strict Zod contract.
type Input = Record<string, any>;
type Outcome = { data: unknown; warnings: string[] };
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",") +
    "}"
  );
}
function cursorEncode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function cursorDecode(cursor: string) {
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (!v || typeof v !== "object" || Array.isArray(v)) throw 0;
    return v as Input;
  } catch {
    throw new AgentError(
      "INVALID_CURSOR",
      "分页游标无效；请从首次读取返回的 next_cursor 继续。",
      422,
    );
  }
}
function binding(value: unknown) {
  return sha256(Buffer.from(canonical(value)));
}
const jsonSafe = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function permissionScopes(actor: Actor) {
  return actor.owner ? [...permissions] : actor.scopes;
}
export function allowedOperations(actor: Actor) {
  return [...operations, uploadOperation].filter((o) =>
    canUse(permissionScopes(actor), o),
  );
}

async function principal(db: Database, actor: Actor): Promise<Actor> {
  if (actor.owner) return actor;
  if (!actor.agentId)
    throw new AgentError(
      "SCOPED_TOKEN_REQUIRED",
      "此接口需要在 Agent 管理台创建的项目范围令牌；旧版全库令牌只用于兼容接口。",
      403,
    );
  const [row] = await db.query<{ project_ids: string[]; scopes: string[] }>(
    "SELECT project_ids,scopes FROM hub_agents WHERE id=$1 AND revoked_at IS NULL FOR SHARE",
    [actor.agentId],
  );
  const [token] = await db.query(
    "SELECT id FROM tokens WHERE id=$1 AND revoked_at IS NULL AND expires_at>now() FOR SHARE",
    [actor.token.id],
  );
  if (!row || !token)
    throw new AgentError(
      "UNAUTHENTICATED",
      "令牌已过期或此 Agent 已撤销。",
      401,
    );
  return { ...actor, scopes: row.scopes, projectIds: row.project_ids };
}
export async function authorize(
  db: Database,
  actor: Actor,
  op: Operation,
  projectId?: string,
) {
  const fresh = await principal(db, actor);
  if (!canUse(permissionScopes(fresh), op))
    throw new AgentError(
      "INSUFFICIENT_SCOPE",
      "当前 Agent 无权执行此操作；请联系所有者授权。",
      403,
      { required_scopes: op.scopes, scope_mode: op.anyScope ? "any" : "all" },
    );
  if (projectId && !fresh.owner && !fresh.projectIds?.includes(projectId))
    throw new AgentError(
      "PROJECT_FORBIDDEN",
      "当前 Agent 无权访问此项目。",
      403,
    );
  if (
    projectId &&
    !(await db.query("SELECT id FROM hub_projects WHERE id=$1", [projectId]))
      .length
  )
    throw new AgentError("NOT_FOUND", "项目不存在。", 404);
  return fresh;
}
async function assertResource(
  db: Database,
  project: string,
  kind: string,
  id: string,
) {
  if ((await resourceProject(db, kind, id)) !== project)
    throw new AgentError("NOT_FOUND", "资源不存在或不属于当前项目。", 404);
}
export async function audit(
  actor: Actor,
  requestId: string,
  operation: string,
  projectId: string | undefined,
  status: number,
  code: string | null,
  replayed = false,
) {
  try {
    await (
      await database()
    ).query(
      "INSERT INTO hub_calls(request_id,actor_id,operation,project_id,status,code,replayed) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
      [
        requestId,
        actor.name,
        operation.slice(0, 80),
        projectId?.slice(0, 64) ?? null,
        status,
        code,
        replayed,
      ],
    );
  } catch {
    console.error("Agent audit append failed", requestId);
  }
}
export async function execute(
  actor: Actor,
  name: string,
  raw: unknown,
  requestId = randomUUID() as string,
  bytes?: Uint8Array,
) {
  let projectId: string | undefined;
  try {
    const op = [...operations, uploadOperation].find((o) => o.name === name);
    if (!op) throw new AgentError("NOT_FOUND", "未知操作。", 404);
    const input = op.input.parse(raw) as Input;
    projectId = input.project_id;
    const db = await database();
    const result = await requestContext.run({ requestId }, () =>
      db.transaction(async (tx) => {
        const fresh = await authorize(tx, actor, op, projectId);
        let outcome: Outcome,
          replayed = false;
        if (op.write) {
          // Consistent lock order (identity -> project -> request -> resource) on all transports.
          await lockProject(tx, projectId!);
          const { idempotency_key, ...payload } = input;
          const hash = binding({
            operation: name,
            payload,
            ...(bytes ? { bytes_sha256: sha256(bytes) } : {}),
          });
          const inserted = await tx.query(
            "INSERT INTO hub_requests(principal_id,project_id,idempotency_key,operation,request_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING principal_id",
            [fresh.name, projectId, idempotency_key, name, hash],
          );
          const [stored] = await tx.query<{
            request_hash: string;
            response: Outcome | null;
          }>(
            "SELECT request_hash,response FROM hub_requests WHERE principal_id=$1 AND project_id=$2 AND idempotency_key=$3 FOR UPDATE",
            [fresh.name, projectId, idempotency_key],
          );
          if (!inserted.length) {
            if (stored.request_hash !== hash)
              throw new AgentError(
                "IDEMPOTENCY_CONFLICT",
                "这个幂等键已经用于不同请求；重试原操作应保持原始参数，新操作请使用新键。",
                409,
                {
                  recovery: {
                    action: "restore_original_payload_or_use_new_key",
                  },
                },
              );
            if (!stored.response)
              throw new AgentError(
                "REQUEST_IN_PROGRESS",
                "请求尚未完成，请稍后使用同一幂等键重试。",
                503,
              );
            outcome = stored.response;
            replayed = true;
          } else {
            outcome = await run(tx, fresh, name, input, bytes);
            // Verify the response before committing business state AND its replay receipt.
            op.output.parse(
              jsonSafe({
                data: outcome.data,
                meta: {
                  request_id: requestId,
                  schema_version: "1.1",
                  committed: true,
                  replayed: false,
                  warnings: outcome.warnings,
                },
              }),
            );
            await tx.query(
              "UPDATE hub_requests SET response=$4::jsonb WHERE principal_id=$1 AND project_id=$2 AND idempotency_key=$3",
              [fresh.name, projectId, idempotency_key, JSON.stringify(outcome)],
            );
          }
        } else outcome = await run(tx, fresh, name, input);
        return op.output.parse(
          jsonSafe({
            data: outcome.data,
            meta: {
              request_id: requestId,
              schema_version: "1.1",
              committed: !!op.write,
              replayed,
              warnings: outcome.warnings,
            },
          }),
        ) as {
          data: Record<string, unknown>;
          meta: {
            request_id: string;
            schema_version: string;
            committed: boolean;
            replayed: boolean;
            warnings: string[];
          };
        };
      }),
    );
    await audit(
      actor,
      requestId,
      name,
      projectId,
      op.method === "POST" ? 201 : 200,
      null,
      result.meta.replayed,
    );
    return result;
  } catch (e) {
    const p = problem(e, requestId);
    await audit(actor, requestId, name, projectId, p.status, p.code);
    throw e;
  }
}

export function markdownBlocks(markdown: string): {
  blocks: Block[];
  warnings: string[];
} {
  // Deliberately small, loss-preserving importer. Unsupported inline syntax stays literal.
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let buffer: string[] = [];
  const add = (
    type: Block["type"],
    text: string,
    extra: Partial<Block> = {},
  ) => {
    if (type === "code" && text.length > 30000)
      throw new AgentError(
        "BLOCK_TOO_LARGE",
        "单个代码块超过 30000 字符；请拆分为多个区块。",
        422,
      );
    if (!text && type === "paragraph") return;
    const chars = Array.from(text);
    // Count by UTF-16 when slicing to respect the persisted domain limit.
    let part = "";
    for (const c of chars) {
      if ((part + c).length > 30000) {
        blocks.push({
          id: randomUUID(),
          type,
          text: part,
          source_refs: [],
          ...extra,
        });
        part = "";
      }
      part += c;
    }
    blocks.push({
      id: randomUUID(),
      type,
      text: part,
      source_refs: [],
      ...extra,
    });
  };
  const flush = () => {
    if (buffer.length) add("paragraph", buffer.join("\n"));
    buffer = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^(#{1,3}) +(.*)$/.exec(line);
    const fence = /^(`{3,}|~{3,})([^\s]*)\s*$/.exec(line);
    if (fence) {
      let end = i + 1;
      while (
        end < lines.length &&
        !new RegExp("^" + fence[1][0] + "{" + fence[1].length + ",}\\s*$").test(
          lines[end],
        )
      )
        end++;
      if (end < lines.length) {
        flush();
        add("code", lines.slice(i + 1, end).join("\n"), {
          lang: fence[2] || "text",
        });
        i = end;
        continue;
      }
    }
    if (heading) {
      flush();
      add("heading", heading[2], { level: heading[1].length });
    } else if (!line.trim()) {
      flush();
    } else buffer.push(line);
  }
  flush();
  if (blocks.length > 300)
    throw new AgentError(
      "TOO_MANY_BLOCKS",
      "Markdown 转换后超过 300 个区块；请拆分文档。",
      422,
    );
  return {
    blocks,
    warnings: [
      "Markdown 仅转换 H1–H3、段落与围栏代码；其余标记保留为字面文本。空行与 CRLF 会规范化。来源关联不代表事实已核实。",
    ],
  };
}
function toMarkdown(title: string, blocks: Block[]) {
  return (
    "# " +
    title +
    "\n\n" +
    blocks
      .map((b) => {
        if (b.type === "heading")
          return "#".repeat(b.level ?? 2) + " " + b.text;
        if (b.type === "code") {
          const length = Math.max(
            3,
            ...[...b.text.matchAll(/`+/g)].map((m) => m[0].length + 1),
          );
          const f = "`".repeat(length);
          return f + (b.lang || "") + "\n" + b.text + "\n" + f;
        }
        if (b.type === "image")
          return "![" + b.text + "](asset://" + b.asset_id + ")";
        if (b.type === "quote")
          return b.text
            .split("\n")
            .map((l) => "> " + l)
            .join("\n");
        if (b.type === "image_prompt" || b.type === "narration")
          return "[" + b.type + "]\n" + b.text;
        return b.text;
      })
      .join("\n\n")
  );
}
function textPage(text: string, v: Input, signature: unknown) {
  const bind = binding(signature);
  let offset = 0;
  if (v.cursor) {
    const c = cursorDecode(v.cursor);
    if (c.bind !== bind || !Number.isInteger(c.offset) || c.offset < 0)
      throw new AgentError(
        "CURSOR_MISMATCH",
        "游标与资源、项目、表示方式或版本不匹配。",
        422,
      );
    offset = c.offset;
  }
  const chars = Array.from(text);
  if (offset > chars.length)
    throw new AgentError("INVALID_CURSOR", "游标范围超出正文。", 422);
  const end = Math.min(offset + v.limit, chars.length),
    more = end < chars.length;
  return {
    text: chars.slice(offset, end).join(""),
    page: {
      total: chars.length,
      unit: "unicode_code_points",
      has_more: more,
      truncated: more || offset > 0,
      next_cursor: more ? cursorEncode({ bind, offset: end }) : null,
    },
  };
}
async function listing(
  db: Database,
  actor: Actor,
  name: string,
  v: Input,
): Promise<Outcome> {
  const scopes = permissionScopes(actor);
  const selections: string[] = [];
  if (
    name === "content_list" ||
    (name === "hub_search" && scopes.includes("content:read"))
  )
    selections.push(
      "SELECT id,title,'content'::text AS type,substring(search_text,1,500) AS excerpt,current_version AS version,created_at FROM contents WHERE project_id=$1 AND search_text ILIKE $2",
    );
  if (name === "hub_search" && scopes.includes("source:read"))
    selections.push(
      "SELECT id,title,'source'::text AS type,substring(markdown,1,500) AS excerpt,NULL::integer AS version,fetched_at AS created_at FROM sources WHERE project_id=$1 AND (title||' '||markdown) ILIKE $2",
    );
  if (name === "artifact_list")
    selections.push(
      "SELECT a.id,a.title,'artifact'::text AS type,a.variant AS excerpt,a.content_version AS version,a.created_at FROM artifacts a JOIN contents c ON c.id=a.content_id WHERE c.project_id=$1 AND a.title ILIKE $2 AND ($6::text IS NULL OR a.content_id=$6)",
    );
  const bind = binding({
    name,
    project_id: v.project_id,
    query: v.query,
    content_id: v.content_id ?? null,
  });
  let time: null | string = null,
    id: string | null = null;
  if (v.cursor) {
    const c = cursorDecode(v.cursor);
    if (
      c.bind !== bind ||
      typeof c.time !== "string" ||
      typeof c.id !== "string" ||
      !Number.isFinite(Date.parse(c.time))
    )
      throw new AgentError(
        "CURSOR_MISMATCH",
        "请勿在不同项目、查询或集合之间复用游标。",
        422,
      );
    time = c.time;
    id = c.id;
  }
  const params: unknown[] = [
    v.project_id,
    "%" + v.query.replace(/[\\%_]/g, "\\$&") + "%",
    time,
    id,
    v.limit + 1,
  ];
  if (name === "artifact_list") params.push(v.content_id ?? null);
  const rows = await db.query<Input>(
    `SELECT *,created_at::text AS sort_time FROM (${selections.join(" UNION ALL ")}) r WHERE ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::text)) ORDER BY created_at DESC,id DESC LIMIT $5`,
    params,
  );
  const more = rows.length > v.limit,
    items = rows.slice(0, v.limit),
    last = items.at(-1);
  return {
    data: {
      items: items.map(({ sort_time, ...row }) => row),
      page: {
        has_more: more,
        next_cursor: more
          ? cursorEncode({ bind, time: last!.sort_time, id: last!.id })
          : null,
      },
      untrusted: true,
    },
    warnings: [],
  };
}
async function run(
  db: Database,
  actor: Actor,
  name: string,
  v: Input,
  bytes?: Uint8Array,
): Promise<Outcome> {
  const outcome = (data: unknown, warnings: string[] = []): Outcome => ({
    data,
    warnings,
  });
  if (name === "hub_capabilities") {
    const projects = await db.query<{ id: string; name: string }>(
      "SELECT id,name FROM hub_projects WHERE $1::boolean OR id=ANY($2::text[]) ORDER BY created_at,id",
      [actor.owner, actor.projectIds ?? []],
    );
    return outcome({
      principal_id: actor.name,
      projects,
      scopes: permissionScopes(actor),
      operations: allowedOperations(actor).map((o) => o.name),
      limits: {
        upload_bytes: 10 * 1024 * 1024,
        text_page_characters: 16000,
        list_items: 50,
      },
      idempotency: {
        scope: "stable Agent ID + project + key; shared by REST and MCP",
        retention:
          "Retained in PostgreSQL until an explicit administrative retention/migration policy changes it; no automatic expiry.",
      },
      features: {
        scoped_mcp_writes: true,
        external_artifacts: true,
        change_feed: true,
        url_capture: false,
        background_jobs: false,
        automatic_publishing: false,
        oauth_scoped_writes: false,
      },
    });
  }
  if (["hub_search", "content_list", "artifact_list"].includes(name))
    return listing(db, actor, name, v);
  if (name === "source_save") {
    if (v.original_url) {
      const u = new URL(v.original_url);
      if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
        throw new AgentError(
          "INVALID_SOURCE_URL",
          "来源链接仅允许不含凭证的 HTTP(S) 地址；此操作不会访问该地址。",
          422,
        );
    }
    const source = await saveSource(
      Buffer.from(v.markdown),
      {
        title: v.title,
        url: v.original_url,
        markdown: v.markdown,
        mime: "text/markdown",
        trust: "low",
        meta: {
          import: "agent",
          created_by: actor.name,
          extraction_version: 1,
        },
      },
      actor.name,
      db,
      v.project_id,
    );
    return outcome(
      { id: source.id, project_id: v.project_id, sha256: source.sha256 },
      ["内容由调用方提供，未自动验证事实；相同原文在同一项目内去重。"],
    );
  }
  if (name === "source_get") {
    await assertResource(db, v.project_id, "source", v.id);
    const [s] = await db.query<Input>("SELECT * FROM sources WHERE id=$1", [
      v.id,
    ]);
    const data: Input = {
      id: s.id,
      project_id: v.project_id,
      title: s.title,
      view: v.view,
      snapshot_sha256: s.sha256,
      text_sha256: sha256(Buffer.from(s.markdown)),
      original_url: s.original_url,
      fetched_at: s.fetched_at,
      extraction_version: 1,
      untrusted: true,
    };
    if (v.view === "summary") {
      if (v.cursor)
        throw new AgentError("INVALID_CURSOR", "摘要视图不接受分页游标。", 422);
      data.excerpt = Array.from(s.markdown).slice(0, 500).join("");
    } else
      Object.assign(
        data,
        textPage(s.markdown, v, {
          id: s.id,
          project_id: v.project_id,
          view: v.view,
          sha: s.sha256,
          text_sha256: sha256(Buffer.from(s.markdown)),
        }),
      );
    return outcome(data);
  }
  if (name === "content_create") {
    let blocks: Block[],
      warnings: string[] = [];
    if (v.markdown !== undefined) {
      ({ blocks, warnings } = markdownBlocks(v.markdown));
    } else blocks = v.blocks.map((b: Block) => ({ ...b, id: randomUUID() }));
    const c = await saveContent(
      { ...v, blocks },
      undefined,
      actor.name,
      db,
      v.project_id,
    );
    return outcome(
      {
        id: c.id,
        project_id: v.project_id,
        version: c.version,
        status: c.status,
      },
      warnings,
    );
  }
  if (name === "content_get") {
    await assertResource(db, v.project_id, "content", v.id);
    // Wrap text cursors with an explicit immutable version so "latest" cannot drift mid-read.
    let effective = v.version;
    let inner = v.cursor;
    if (v.cursor) {
      const cursor = cursorDecode(v.cursor);
      if (!Number.isInteger(cursor.version) || cursor.version < 1)
        throw new AgentError(
          "INVALID_CURSOR",
          "内容游标必须包含已读取的版本。",
          422,
        );
      if (effective !== undefined && effective !== cursor.version)
        throw new AgentError("CURSOR_MISMATCH", "版本号与游标不一致。", 422);
      effective = cursor.version;
      inner = cursor.inner;
    }
    const c = await getContent(v.id, effective, db);
    const data: Input = {
      id: c.id,
      project_id: v.project_id,
      title: c.title,
      version: c.version,
      current_version: c.current_version,
      status: c.status,
      tags: c.tags,
      source_ids: c.source_ids,
      block_count: c.blocks.length,
      view: v.view,
      untrusted: true,
    };
    if (v.view === "summary") {
      if (v.cursor)
        throw new AgentError("INVALID_CURSOR", "摘要视图不接受分页游标。", 422);
      data.excerpt = Array.from(c.blocks.map((b) => b.text).join("\n"))
        .slice(0, 500)
        .join("");
      return outcome(data);
    }
    const signature = {
      id: c.id,
      project_id: v.project_id,
      version: c.version,
      view: v.view,
    };
    if (v.view === "markdown")
      Object.assign(
        data,
        textPage(
          toMarkdown(c.title, c.blocks),
          { ...v, cursor: inner },
          signature,
        ),
      );
    else {
      const bind = binding(signature);
      let index = 0;
      if (inner) {
        const cur = cursorDecode(inner);
        if (cur.bind !== bind || !Number.isInteger(cur.index) || cur.index < 0)
          throw new AgentError("CURSOR_MISMATCH", "区块游标不匹配。", 422);
        index = cur.index;
      }
      if (index > c.blocks.length)
        throw new AgentError("INVALID_CURSOR", "区块游标越界。", 422);
      data.blocks = c.blocks.slice(index, index + 1);
      const more = index + 1 < c.blocks.length;
      data.page = {
        total: c.blocks.length,
        unit: "complete_blocks",
        has_more: more,
        next_cursor: more ? cursorEncode({ bind, index: index + 1 }) : null,
        truncated: false,
      };
    }
    if (data.page.next_cursor)
      data.page.next_cursor = cursorEncode({
        version: c.version,
        inner: data.page.next_cursor,
      });
    return outcome(
      data,
      v.view === "blocks"
        ? [
            "区块视图每页一个完整区块，绝不截断供修改的正文；limit 只用于 Markdown 文本页。",
          ]
        : [],
    );
  }
  if (name === "content_update_blocks") {
    await assertResource(db, v.project_id, "content", v.id);
    const c = await getContent(v.id, undefined, db);
    if (c.current_version !== v.expected_version)
      throw new AgentError(
        "VERSION_CONFLICT",
        "此次修改未写入；读取最新版本并比较修改后再提交，不要只替换版本号强行覆盖。",
        409,
        {
          content_id: c.id,
          expected_version: v.expected_version,
          current_version: c.current_version,
          recovery: { action: "read_compare_then_retry" },
        },
      );
    let blocks = c.blocks.map((b) => ({ ...b }));
    const indexOf = (id: string) => {
      const index = blocks.findIndex((b) => b.id === id);
      if (index < 0)
        throw new AgentError(
          "BLOCK_NOT_FOUND",
          "指定区块不存在；请重新读取区块 ID。",
          422,
          { block_id: id },
        );
      return index;
    };
    for (const op of v.operations) {
      if (op.op === "replace_text") {
        const i = indexOf(op.block_id);
        blocks[i] = {
          ...blocks[i],
          text: op.text,
          ...(op.source_refs ? { source_refs: op.source_refs } : {}),
        };
      } else if (op.op === "remove") blocks.splice(indexOf(op.block_id), 1);
      else if (op.op === "append") {
        const at = op.after_block_id === null ? -1 : indexOf(op.after_block_id);
        blocks.splice(at + 1, 0, { ...op.block, id: randomUUID() });
      } else {
        if (op.block_id === op.after_block_id)
          throw new AgentError(
            "INVALID_MOVE",
            "不能把区块移动到它自己后面。",
            422,
          );
        const [b] = blocks.splice(indexOf(op.block_id), 1);
        const at = op.after_block_id === null ? -1 : indexOf(op.after_block_id);
        blocks.splice(at + 1, 0, b);
      }
    }
    const input: ContentInput = {
      title: v.title ?? c.title,
      status: v.status ?? c.status,
      tags: v.tags ?? c.tags,
      source_ids: v.source_ids ?? c.source_ids,
      blocks,
      expected_version: v.expected_version,
    };
    const saved = await saveContent(input, c.id, actor.name, db, v.project_id);
    return outcome({
      id: saved.id,
      project_id: v.project_id,
      version: saved.version,
      status: saved.status,
    });
  }
  if (name === "file_upload" || name === "file_save_text") {
    const body =
      name === "file_save_text"
        ? Buffer.from(v.text)
        : Buffer.from(bytes ?? []);
    if (body.length > 10 * 1024 * 1024)
      throw new AgentError("PAYLOAD_TOO_LARGE", "单文件上限为 10 MiB。", 413);
    let assetId: string | null = null;
    if (v.mime.startsWith("image/")) {
      const asset = await saveAsset(body, v.name, actor.name, db, v.project_id);
      assetId = asset.id;
    }
    const hash = await putBlob(body),
      id = randomUUID();
    const [file] = await db.query(
      "INSERT INTO hub_files(id,project_id,name,mime,bytes,sha256,asset_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        id,
        v.project_id,
        v.name,
        v.mime,
        body.length,
        hash,
        assetId,
        actor.name,
      ],
    );
    await event(db, "file.saved", actor.name, id, { sha256: hash });
    return outcome(file);
  }
  if (name === "file_get") {
    await assertResource(db, v.project_id, "file", v.id);
    return outcome(
      (await db.query("SELECT * FROM hub_files WHERE id=$1", [v.id]))[0],
    );
  }
  if (name === "artifact_register") {
    await assertResource(db, v.project_id, "content", v.content_id);
    await assertResource(db, v.project_id, "file", v.file_id);
    const content = await getContent(v.content_id, v.content_version, db);
    const [file] = await db.query<Input>(
      "SELECT * FROM hub_files WHERE id=$1",
      [v.file_id],
    );
    const matches: Record<string, string[]> = {
      html: ["text/html"],
      markdown: ["text/markdown"],
      text: ["text/plain"],
      json: ["application/json"],
      pdf: ["application/pdf"],
      image: ["image/png", "image/jpeg", "image/webp"],
      video: ["video/mp4"],
      audio: ["audio/mpeg"],
    };
    if (v.kind !== "binary" && !matches[v.kind]?.includes(file.mime))
      throw new AgentError(
        "ARTIFACT_FORMAT_MISMATCH",
        "产物类型与已上传文件的 MIME 类型不一致。",
        422,
      );
    if (Buffer.byteLength(JSON.stringify(v.recipe)) > 16384)
      throw new AgentError(
        "RECIPE_TOO_LARGE",
        "生成说明最大 16 KiB；不要在其中嵌入文件或凭证。",
        422,
      );
    const ext: Record<string, string> = {
      html: "html",
      markdown: "md",
      text: "txt",
      json: "json",
      pdf: "pdf",
      image: "img",
      video: "mp4",
      audio: "mp3",
      binary: "bin",
    };
    const id = randomUUID(),
      recipe = {
        external: true,
        registered_by: actor.name,
        file_id: file.id,
        producer_metadata: v.recipe,
        ext: ext[v.kind],
      };
    const rows = await db.query<Input>(
      "INSERT INTO artifacts(id,content_id,content_version,title,kind,variant,sha256,bytes,mime,recipe,external_file_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) ON CONFLICT DO NOTHING RETURNING *",
      [
        id,
        content.id,
        content.version,
        content.title,
        v.kind,
        v.variant,
        file.sha256,
        file.bytes,
        file.mime,
        JSON.stringify(recipe),
        file.id,
      ],
    );
    const artifact =
      rows[0] ??
      (
        await db.query<Input>(
          "SELECT * FROM artifacts WHERE content_id=$1 AND content_version=$2 AND kind=$3 AND variant=$4 AND sha256=$5",
          [content.id, content.version, v.kind, v.variant, file.sha256],
        )
      )[0];
    await event(
      db,
      rows.length ? "artifact.registered" : "artifact.deduplicated",
      actor.name,
      artifact.id,
      { version: content.version },
    );
    return outcome({
      id: artifact.id,
      project_id: v.project_id,
      version: content.version,
      sha256: file.sha256,
      bytes: file.bytes,
    });
  }
  if (name === "artifact_get") {
    await assertResource(db, v.project_id, "artifact", v.id);
    return outcome(
      (
        await db.query(
          "SELECT a.*,c.project_id,(a.content_version<c.current_version) AS stale FROM artifacts a JOIN contents c ON c.id=a.content_id WHERE a.id=$1",
          [v.id],
        )
      )[0],
    );
  }
  if (name === "hub_changes") {
    const [{ change_seq: high }] = await db.query<{ change_seq: string }>(
      "SELECT change_seq::text FROM hub_projects WHERE id=$1",
      [v.project_id],
    );
    if (BigInt(v.cursor) > BigInt(high))
      throw new AgentError(
        "CURSOR_AHEAD",
        "游标超过此项目当前序号；请确认项目与游标对应。",
        422,
      );
    const scopes = permissionScopes(actor),
      types: string[] = [];
    for (const [type, scope] of Object.entries({
      content: "content:read",
      source: "source:read",
      asset: "file:read",
      file: "file:read",
      artifact: "artifact:read",
    }))
      if (scopes.includes(scope)) types.push(type);
    const rows = await db.query<Input>(
      "SELECT seq::text,type,resource_type,resource_id,version,actor_id,request_id,created_at FROM hub_changes WHERE project_id=$1 AND seq>$2::bigint AND seq<=$3::bigint AND resource_type=ANY($4::text[]) ORDER BY seq LIMIT $5",
      [v.project_id, v.cursor, high, types, v.limit + 1],
    );
    const more = rows.length > v.limit,
      items = rows.slice(0, v.limit);
    return outcome({
      items,
      page: { has_more: more, next_cursor: more ? items.at(-1)!.seq : high },
      through_sequence: high,
    });
  }
  throw new AgentError("NOT_IMPLEMENTED", "此操作尚未实现。", 501);
}
export async function download(
  actor: Actor,
  kind: "file" | "artifact",
  id: string,
  projectId: string,
  requestId: string,
) {
  const db = await database();
  try {
    const op = operations.find((o) => o.name === kind + "_get")!;
    const result = await db.transaction(async (tx) => {
      await authorize(tx, actor, op, projectId);
      await assertResource(tx, projectId, kind, id);
      const [row] = await tx.query<Input>(
        kind === "file"
          ? "SELECT sha256,name AS filename FROM hub_files WHERE id=$1"
          : "SELECT sha256,title||'-v'||content_version AS filename FROM artifacts WHERE id=$1",
        [id],
      );
      return { bytes: await getBlob(row.sha256), name: row.filename as string };
    });
    await audit(actor, requestId, kind + "_download", projectId, 200, null);
    return result;
  } catch (e) {
    const p = problem(e, requestId);
    await audit(
      actor,
      requestId,
      kind + "_download",
      projectId,
      p.status,
      p.code,
    );
    throw e;
  }
}
