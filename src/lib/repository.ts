import {
  lockProject,
  resourceProject,
  requestContext,
} from "./agent/context.ts";
import { randomUUID } from "node:crypto";
import { database, type Database } from "./db.ts";
import { getBlob, putBlob } from "./storage.ts";
import {
  HubError,
  parseContent,
  renderContent,
  text,
  choice,
  object,
  validId,
  type Content,
  type ContentDetail,
  type Source,
  type Asset,
  type Artifact,
  type Publication,
  type Block,
  type RenderAsset,
} from "./domain.ts";
export async function event(
  tx: Database,
  type: string,
  actor: string,
  id: string | null,
  payload: Record<string, unknown> = {},
) {
  await tx.query(
    "INSERT INTO events(type,actor,subject_id,payload) VALUES($1,$2,$3,$4::jsonb)",
    [type, actor, id, JSON.stringify(payload)],
  );
  const kind = type.split(".")[0];
  const project = id ? await resourceProject(tx, kind, id) : null;
  if (project) {
    const [counter] = await tx.query<{ change_seq: string }>(
      "UPDATE hub_projects SET change_seq=change_seq+1 WHERE id=$1 RETURNING change_seq::text",
      [project],
    );
    await tx.query(
      "INSERT INTO hub_changes(project_id,seq,type,resource_type,resource_id,version,actor_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        project,
        counter.change_seq,
        type,
        kind,
        id,
        typeof payload.version === "number" ? payload.version : null,
        actor,
        requestContext.getStore()?.requestId ?? "legacy:" + randomUUID(),
      ],
    );
  }
}
export async function saveContent(
  value: unknown,
  id?: string,
  actor = "owner",
  connection?: Database,
  projectId = "default",
): Promise<ContentDetail> {
  const input = parseContent(value);
  projectId = input.project_id ?? projectId;
  const db = connection ?? (await database());
  const contentId = id ? validId(id) : randomUUID();
  return db.transaction(async (tx) => {
    const project = id ? await resourceProject(tx, "content", id) : projectId;
    if (!project) throw new HubError("内容不存在", 404);
    await lockProject(tx, project);
    let version = 1;
    if (id) {
      if (!input.expected_version)
        throw new HubError("更新必须携带 expected_version", 428);
      const rows = await tx.query<Content>(
        "SELECT * FROM contents WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!rows[0]) throw new HubError("内容不存在", 404);
      if (rows[0].current_version !== input.expected_version)
        throw new HubError(
          "这篇内容已在其他窗口更新。你的编辑尚未覆盖服务器，请复制编辑后重新打开。",
          409,
        );
      version = rows[0].current_version + 1;
    }
    for (const sourceId of input.source_ids)
      if (
        !(
          await tx.query(
            "SELECT id FROM sources WHERE id=$1 AND project_id=$2",
            [sourceId, project],
          )
        )[0]
      )
        throw new HubError("关联来源不存在");
    for (const block of input.blocks.filter((b) => b.type === "image"))
      if (
        !(
          await tx.query(
            "SELECT id FROM assets WHERE id=$1 AND project_id=$2",
            [block.asset_id, project],
          )
        )[0]
      )
        throw new HubError("图片素材不存在");
    const searchable = [
      input.title,
      ...input.tags,
      ...input.blocks.map((b) => b.text),
    ].join("\n");
    if (!id)
      await tx.query(
        "INSERT INTO contents(id,title,status,tags,current_version,search_text,project_id) VALUES($1,$2,$3,$4,1,$5,$6)",
        [
          contentId,
          input.title,
          input.status,
          input.tags,
          searchable,
          projectId,
        ],
      );
    else
      await tx.query(
        "UPDATE contents SET title=$2,status=$3,tags=$4,current_version=$5,search_text=$6,updated_at=now() WHERE id=$1",
        [id, input.title, input.status, input.tags, version, searchable],
      );
    await tx.query(
      "INSERT INTO content_versions(content_id,version,title,status,tags) VALUES($1,$2,$3,$4,$5)",
      [contentId, version, input.title, input.status, input.tags],
    );
    for (const [seq, block] of input.blocks.entries())
      await tx.query(
        "INSERT INTO content_blocks(content_id,version,seq,type,payload) VALUES($1,$2,$3,$4,$5::jsonb)",
        [contentId, version, seq, block.type, JSON.stringify(block)],
      );
    for (const sourceId of input.source_ids)
      await tx.query(
        "INSERT INTO content_sources(content_id,version,source_id) VALUES($1,$2,$3)",
        [contentId, version, sourceId],
      );
    await event(
      tx,
      id ? "content.versioned" : "content.created",
      actor,
      contentId,
      { version, title: input.title },
    );
    return getContent(contentId, version, tx);
  });
}
export async function getContent(
  id: string,
  version?: number,
  tx?: Database,
): Promise<ContentDetail> {
  const db = tx ?? (await database());
  const [content] = await db.query<Content>(
    "SELECT * FROM contents WHERE id=$1",
    [validId(id)],
  );
  if (!content) throw new HubError("内容不存在", 404);
  const v = version ?? content.current_version;
  if (!Number.isInteger(v) || v < 1) throw new HubError("版本号无效");
  const [revision] = await db.query<{
    title: string;
    status: Content["status"];
    tags: string[];
  }>(
    "SELECT title,status,tags FROM content_versions WHERE content_id=$1 AND version=$2",
    [id, v],
  );
  if (!revision) throw new HubError("版本不存在", 404);
  const blocks = await db.query<{ payload: Block }>(
    "SELECT payload FROM content_blocks WHERE content_id=$1 AND version=$2 ORDER BY seq",
    [id, v],
  );
  const refs = await db.query<{ source_id: string }>(
    "SELECT source_id FROM content_sources WHERE content_id=$1 AND version=$2 ORDER BY source_id",
    [id, v],
  );
  return {
    ...content,
    ...revision,
    version: v,
    blocks: blocks.map((b) => b.payload),
    source_ids: refs.map((s) => s.source_id),
  };
}
export async function contentVersions(id: string) {
  return (await database()).query(
    "SELECT version,title,status,created_at FROM content_versions WHERE content_id=$1 ORDER BY version DESC",
    [validId(id)],
  );
}
export async function listContents(query = "", offset = 0) {
  return (await database()).query<Content>(
    `SELECT c.project_id,c.id,c.title,c.status,c.tags,c.current_version,c.created_at,c.updated_at,substring(c.search_text,1,180) AS excerpt,(SELECT count(*)::int FROM content_sources s WHERE s.content_id=c.id AND s.version=c.current_version) AS source_count FROM contents c WHERE c.search_text ILIKE $1 ORDER BY c.updated_at DESC LIMIT 100 OFFSET $2`,
    ["%" + query.replace(/[\\%_]/g, "\\$&") + "%", offset],
  );
}
export async function sourceById(id: string): Promise<Source> {
  const [source] = await (
    await database()
  ).query<Source>("SELECT * FROM sources WHERE id=$1", [validId(id)]);
  if (!source) throw new HubError("来源不存在", 404);
  return source;
}
export async function saveSource(
  bytes: Uint8Array,
  input: {
    title: string;
    url?: string;
    markdown: string;
    mime: string;
    trust?: string;
    meta?: Record<string, unknown>;
    images?: { asset_id: string; origin_url: string; alt: string }[];
  },
  actor = "owner",
  connection?: Database,
  projectId = "default",
): Promise<Source> {
  const hash = await putBlob(bytes);
  const db = connection ?? (await database());
  let id = randomUUID() as string;
  await db.transaction(async (tx) => {
    await lockProject(tx, projectId);
    const inserted = await tx.query<Source>(
      "INSERT INTO sources(id,title,original_url,sha256,markdown,mime,trust_level,meta,project_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT(project_id,sha256) DO NOTHING RETURNING *",
      [
        id,
        text(input.title, "标题"),
        input.url || null,
        hash,
        input.markdown,
        input.mime,
        input.trust ?? "medium",
        JSON.stringify(input.meta ?? {}),
        projectId,
      ],
    );
    if (!inserted[0])
      id = (
        await tx.query<Source>(
          "SELECT * FROM sources WHERE sha256=$1 AND project_id=$2",
          [hash, projectId],
        )
      )[0].id;
    if (input.url)
      await tx.query(
        "INSERT INTO source_locations(source_id,url) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [id, input.url],
      );
    for (const img of input.images ?? [])
      await tx.query(
        "INSERT INTO source_images(source_id,asset_id,origin_url,alt) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [id, img.asset_id, img.origin_url, img.alt],
      );
    await event(
      tx,
      inserted[0] ? "source.saved" : "source.deduplicated",
      actor,
      id,
      { title: input.title, sha256: hash },
    );
  });
  const [source] = await db.query<Source>("SELECT * FROM sources WHERE id=$1", [
    id,
  ]);
  return source;
}
export async function saveAsset(
  bytes: Uint8Array,
  name: string,
  actor = "owner",
  connection?: Database,
  projectId = "default",
): Promise<Asset> {
  if (bytes.length > 10 * 1024 * 1024)
    throw new HubError("图片最大 10 MB", 413);
  // Only raster formats. SVG is deliberately not parsed, preventing external resource resolution.
  const b = Buffer.from(bytes);
  const raster =
    (b[0] === 0xff && b[1] === 0xd8) ||
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP");
  if (!raster) throw new HubError("仅支持 JPEG、PNG、WebP 图片");
  const sharp = (await import("sharp")).default;
  const result = await sharp(bytes, {
    limitInputPixels: 40000000,
    animated: false,
  })
    .rotate()
    .resize({
      width: 4096,
      height: 4096,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 88 })
    .toBuffer({ resolveWithObject: true });
  const hash = await putBlob(result.data);
  const db = connection ?? (await database());
  return db.transaction(async (tx) => {
    await lockProject(tx, projectId);
    const rows = await tx.query<Asset>(
      "INSERT INTO assets(id,sha256,mime,bytes,width,height,name,project_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(project_id,sha256) DO NOTHING RETURNING *",
      [
        randomUUID(),
        hash,
        "image/webp",
        result.data.length,
        result.info.width,
        result.info.height,
        name.slice(0, 200),
        projectId,
      ],
    );
    const asset =
      rows[0] ??
      (
        await tx.query<Asset>(
          "SELECT * FROM assets WHERE sha256=$1 AND project_id=$2",
          [hash, projectId],
        )
      )[0];
    await event(tx, "asset.saved", actor, asset.id, {
      name: asset.name,
      sha256: hash,
    });
    return asset;
  });
}
export async function renderArtifact(
  id: string,
  version: number,
  kind: string,
  variant: string,
  actor = "owner",
): Promise<Artifact> {
  const content = await getContent(id, version);
  const assets: Record<string, RenderAsset> = {};
  const db = await database();
  let total = 0;
  for (const block of content.blocks.filter((b) => b.type === "image")) {
    const [asset] = await db.query<Asset>("SELECT * FROM assets WHERE id=$1", [
      block.asset_id,
    ]);
    if (!asset) throw new HubError("图片素材不存在", 404);
    const bytes = await getBlob(asset.sha256);
    total += bytes.length;
    if (total > 20 * 1024 * 1024)
      throw new HubError("单个产物图片总量超过 20 MB");
    assets[asset.id] = { mime: asset.mime, base64: bytes.toString("base64") };
  }
  const rendered = renderContent(content, kind, variant, assets);
  const bytes = Buffer.from(rendered.body);
  const hash = await putBlob(bytes);
  return db.transaction(async (tx) => {
    const project = await resourceProject(tx, "content", id);
    if (!project) throw new HubError("内容不存在", 404);
    await lockProject(tx, project);
    const rows = await tx.query<Artifact>(
      "INSERT INTO artifacts(id,content_id,content_version,title,kind,variant,sha256,bytes,mime,recipe) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT DO NOTHING RETURNING *",
      [
        randomUUID(),
        id,
        version,
        content.title,
        kind,
        variant,
        hash,
        bytes.length,
        rendered.mime,
        JSON.stringify({
          renderer: "content-hub/1",
          kind,
          variant,
          content_version: version,
          images: "embedded-webp",
          ext: rendered.ext,
        }),
      ],
    );
    const artifact =
      rows[0] ??
      (
        await tx.query<Artifact>(
          "SELECT * FROM artifacts WHERE content_id=$1 AND content_version=$2 AND kind=$3 AND variant=$4 AND sha256=$5",
          [id, version, kind, variant, hash],
        )
      )[0];
    await event(tx, "artifact.frozen", actor, artifact.id, {
      content_id: id,
      version,
      sha256: hash,
    });
    return artifact;
  });
}
export async function savePublication(
  value: unknown,
  id?: string,
  actor = "owner",
): Promise<Publication> {
  const v = object(value);
  const artifactId = validId(v.artifact_id);
  const platform = choice(
    v.platform,
    ["wechat", "x", "xiaohongshu", "zhihu", "douyin", "other"],
    "平台",
  );
  const status = choice(
    v.status,
    ["draft", "submitted", "published", "rejected", "removed"],
    "发布状态",
  );
  const note = text(v.note ?? "", "备注", 2000, false);
  let url = text(v.url ?? "", "发布链接", 2000, false);
  if (url) {
    try {
      const u = new URL(url);
      if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
        throw 0;
      url = u.href;
    } catch {
      throw new HubError("发布链接必须是 HTTP(S) 链接");
    }
  }
  if (status === "published" && !url)
    throw new HubError("标记已发布时必须填写平台原文链接");
  const db = await database();
  const pid = id ? validId(id) : randomUUID();
  return db.transaction(async (tx) => {
    const project = await resourceProject(tx, "artifact", artifactId);
    if (!project) throw new HubError("产物不存在", 404);
    await lockProject(tx, project);
    if (
      !(await tx.query("SELECT id FROM artifacts WHERE id=$1", [artifactId]))[0]
    )
      throw new HubError("产物不存在", 404);
    if (id) {
      const old = await tx.query<{ artifact_id: string; platform: string }>(
        "SELECT artifact_id,platform FROM publications WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!old[0]) throw new HubError("记录不存在", 404);
      if (old[0].artifact_id !== artifactId || old[0].platform !== platform)
        throw new HubError("不能改变发布记录绑定的产物或平台");
      await tx.query(
        "UPDATE publications SET status=$2,url=$3,note=$4,updated_at=now(),published_at=CASE WHEN $2='published' THEN COALESCE(published_at,now()) ELSE published_at END WHERE id=$1",
        [id, status, url || null, note],
      );
    } else
      await tx.query(
        "INSERT INTO publications(id,artifact_id,platform,status,url,note,published_at) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $4='published' THEN now() ELSE NULL END)",
        [pid, artifactId, platform, status, url || null, note],
      );
    await event(tx, "publication.recorded", actor, pid, {
      artifact_id: artifactId,
      platform,
      status,
      method: "manual-confirmation",
    });
    return (
      await tx.query<Publication>(
        "SELECT p.*,a.title FROM publications p JOIN artifacts a ON a.id=p.artifact_id WHERE p.id=$1",
        [pid],
      )
    )[0];
  });
}
export async function searchHub(query: string) {
  const q = "%" + query.replace(/[\\%_]/g, "\\$&") + "%";
  return (await database()).query<{
    id: string;
    title: string;
    type: string;
    excerpt: string;
  }>(
    `SELECT id,title,'content' AS type,substring(search_text,1,600) AS excerpt FROM contents WHERE status<>'archived' AND search_text ILIKE $1 UNION ALL SELECT id,title,'source' AS type,substring(markdown,1,600) AS excerpt FROM sources WHERE (title||' '||markdown) ILIKE $1 LIMIT 50`,
    [q],
  );
}
