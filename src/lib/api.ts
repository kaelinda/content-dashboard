import { randomUUID } from "node:crypto";
import { database } from "./db.ts";
import {
  authenticate,
  cookieValue,
  issueToken,
  oauthClients,
  origin,
  rateLimit,
  READ,
  WRITE,
  requireOrigin,
  sessionCookie,
  validateAuthorization,
} from "./auth.ts";
import { digestToken, verifyPassword } from "./crypto.ts";
import { binary, errorResponse, json, readBytes, readJson } from "./http.ts";
import {
  HubError,
  choice,
  object,
  text,
  validId,
  type Artifact,
  type Asset,
  type Source,
  type HubEvent,
  type Publication,
} from "./domain.ts";
import {
  contentVersions,
  event,
  getContent,
  listContents,
  renderArtifact,
  saveAsset,
  saveContent,
  savePublication,
  saveSource,
  searchHub,
  sourceById,
} from "./repository.ts";
import { getBlob } from "./storage.ts";
import { extractHtml, ingestUrl } from "./ingest.ts";
import { exportBackup } from "./backup.ts";
function pageOffset(url: URL) {
  const value = Number(url.searchParams.get("offset") || 0);
  if (!Number.isInteger(value) || value < 0 || value > 100000)
    throw new HubError("分页参数错误");
  return value;
}
export async function handle(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const parts = url.pathname
      .replace(/^\/api\/?/, "")
      .split("/")
      .filter(Boolean);
    const route = parts[0];
    const method = request.method;
    if (route === "health" && method === "GET") {
      await (await database()).query("SELECT 1");
      return json({ ok: true });
    }
    if (route === "auth" && parts[1] === "status" && method === "GET") {
      let authenticated = false;
      try {
        authenticated = (await authenticate(request, false, true)).owner;
      } catch (e) {
        if (!(e instanceof HubError) || e.status !== 401) throw e;
      }
      return json({
        configured: !!process.env.OWNER_PASSWORD_HASH,
        authenticated,
      });
    }
    if (route === "auth" && parts[1] === "login" && method === "POST") {
      requireOrigin(request);
      await rateLimit("owner-login", 10, 900);
      if (!process.env.OWNER_PASSWORD_HASH)
        throw new HubError("尚未初始化，请先在服务器运行 npm run setup", 503);
      const body = object(await readJson(request));
      const password = text(body.password, "密码", 1024);
      if (!verifyPassword(password, process.env.OWNER_PASSWORD_HASH))
        throw new HubError("密码不正确", 401);
      const session = await issueToken(
        "session",
        "owner",
        [READ, WRITE],
        43200,
        { password_fingerprint: digestToken(process.env.OWNER_PASSWORD_HASH) },
      );
      await event(await database(), "auth.login", "owner", session.id);
      return json({ ok: true }, 200, {
        "Set-Cookie": sessionCookie(session.token),
      });
    }
    const write = !["GET", "HEAD"].includes(method);
    const actor = await authenticate(request, write);
    if (write) await rateLimit("writes:" + actor.token.id, 120, 60);
    if (route === "auth" && parts[1] === "logout" && method === "POST") {
      await (
        await database()
      ).query("UPDATE tokens SET revoked_at=now() WHERE hash=$1", [
        digestToken(cookieValue(request)),
      ]);
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", true) });
    }
    if (route === "hub" && method === "GET") {
      const db = await database();
      const [counts] = await db.query<{
        contents: number;
        sources: number;
        artifacts: number;
        published: number;
      }>(
        "SELECT (SELECT count(*)::int FROM contents) AS contents,(SELECT count(*)::int FROM sources) AS sources,(SELECT count(*)::int FROM artifacts) AS artifacts,(SELECT count(*)::int FROM publications WHERE status='published') AS published",
      );
      const [contents, sources, artifacts, publications, assets, events] =
        await Promise.all([
          listContents(),
          db.query<Source>(
            "SELECT id,title,original_url,substring(markdown,1,280) AS markdown,sha256,trust_level,meta,fetched_at FROM sources ORDER BY fetched_at DESC LIMIT 100",
          ),
          db.query<Artifact>(
            "SELECT a.*, (a.content_version<c.current_version) AS stale FROM artifacts a JOIN contents c ON c.id=a.content_id ORDER BY a.created_at DESC LIMIT 100",
          ),
          db.query<Publication>(
            "SELECT p.*,a.title FROM publications p JOIN artifacts a ON a.id=p.artifact_id ORDER BY p.updated_at DESC LIMIT 100",
          ),
          db.query<Asset>(
            "SELECT * FROM assets ORDER BY created_at DESC LIMIT 100",
          ),
          db.query<HubEvent>("SELECT * FROM events ORDER BY id DESC LIMIT 30"),
        ]);
      return json({
        contents,
        sources,
        artifacts,
        publications,
        assets,
        events,
        counts,
        system: {
          database: db.engine,
          storage: process.env.STORAGE_DRIVER || "local",
          mcp: origin() + "/mcp",
          oauth_clients: oauthClients().map((c) => ({
            id: c.id,
            name: c.name,
          })),
        },
      });
    }
    if (route === "search" && method === "GET")
      return json(
        await searchHub(
          text(url.searchParams.get("q") ?? "", "搜索词", 200, false),
        ),
      );
    if (route === "contents") {
      if (parts.length === 1 && method === "GET")
        return json(
          await listContents(
            text(url.searchParams.get("q") ?? "", "搜索词", 200, false),
            pageOffset(url),
          ),
        );
      if (parts.length === 1 && method === "POST")
        return json(
          await saveContent(await readJson(request), undefined, actor.name),
          201,
        );
      if (parts[1]) {
        const id = validId(parts[1]);
        if (parts[2] === "versions" && method === "GET")
          return json(await contentVersions(id));
        if (parts[2] === "render" && method === "POST") {
          const body = object(await readJson(request));
          return json(
            await renderArtifact(
              id,
              Number(body.version),
              text(body.kind, "产物类型", 20),
              text(body.variant, "产物变体", 30),
              actor.name,
            ),
            201,
          );
        }
        if (parts.length === 2 && method === "GET")
          return json(
            await getContent(
              id,
              url.searchParams.has("version")
                ? Number(url.searchParams.get("version"))
                : undefined,
            ),
          );
        if (parts.length === 2 && method === "PATCH")
          return json(
            await saveContent(await readJson(request), id, actor.name),
          );
      }
    }
    if (route === "sources") {
      if (parts.length === 1 && method === "GET")
        return json(
          await (
            await database()
          ).query(
            "SELECT id,title,original_url,substring(markdown,1,280) AS markdown,sha256,trust_level,meta,fetched_at FROM sources WHERE (title||markdown) ILIKE $1 ORDER BY fetched_at DESC LIMIT 100 OFFSET $2",
            [
              "%" +
                (url.searchParams.get("q") || "")
                  .slice(0, 200)
                  .replace(/[\\%_]/g, "\\$&") +
                "%",
              pageOffset(url),
            ],
          ),
        );
      if (parts[1] === "url" && method === "POST") {
        await rateLimit("ingest:" + actor.token.id, 30, 3600);
        const body = object(await readJson(request));
        return json(
          await ingestUrl(
            text(body.url, "来源链接", 2000),
            body.include_images === true,
            actor.name,
          ),
          201,
        );
      }
      if (parts[1] === "upload" && method === "POST") {
        const bytes = await readBytes(request, 10 * 1024 * 1024);
        const name = decodeURIComponent(
          request.headers.get("x-filename") || "导入文件",
        ).slice(0, 200);
        const html = /\.html?$/i.test(name);
        const pdf = /\.pdf$/i.test(name);
        if (!/\.(html?|md|txt|pdf)$/i.test(name))
          throw new HubError("支持 HTML、Markdown、TXT 和 PDF 快照");
        const extracted = html
          ? extractHtml(bytes.toString("utf8"))
          : {
              title: name,
              markdown: pdf
                ? "此 PDF 仅保留原始快照，尚未提取正文。请在来源备注或新内容中补充必要的原文引用。"
                : bytes.toString("utf8"),
            };
        return json(
          await saveSource(
            bytes,
            {
              title: extracted.title || name,
              markdown: extracted.markdown,
              mime: html ? "text/html" : pdf ? "application/pdf" : "text/plain",
              meta: {
                name,
                import: "file",
                text_extraction: pdf ? "not-supported" : "utf-8",
              },
            },
            actor.name,
          ),
          201,
        );
      }
      if (parts.length === 1 && method === "POST") {
        const body = object(await readJson(request));
        const markdown = text(body.markdown, "来源正文", 500000);
        const title = text(body.title, "来源标题");
        const original = text(body.url ?? "", "来源链接", 2000, false);
        if (original) {
          let u: URL;
          try {
            u = new URL(original);
          } catch {
            throw new HubError("来源链接无效");
          }
          if (
            !["http:", "https:"].includes(u.protocol) ||
            u.username ||
            u.password
          )
            throw new HubError("来源链接无效");
        }
        return json(
          await saveSource(
            Buffer.from(markdown),
            {
              title,
              url: original,
              markdown,
              mime: "text/markdown",
              trust: choice(
                body.trust_level ?? "medium",
                ["high", "medium", "low"],
                "可信度",
              ),
              meta: { import: "manual" },
            },
            actor.name,
          ),
          201,
        );
      }
      if (parts[1] && method === "GET") {
        const source = await sourceById(parts[1]);
        if (parts[2] === "snapshot")
          return binary(
            await getBlob(source.sha256),
            "application/octet-stream",
            `${source.title}.snapshot`,
          );
        if (parts.length === 2) {
          const db = await database();
          return json({
            ...source,
            locations: await db.query(
              "SELECT url,fetched_at FROM source_locations WHERE source_id=$1",
              [source.id],
            ),
            images: await db.query(
              "SELECT si.*,a.mime,a.width,a.height FROM source_images si JOIN assets a ON a.id=si.asset_id WHERE source_id=$1",
              [source.id],
            ),
          });
        }
      }
    }
    if (route === "assets") {
      if (parts.length === 1 && method === "GET")
        return json(
          await (
            await database()
          ).query(
            "SELECT * FROM assets ORDER BY created_at DESC LIMIT 100 OFFSET $1",
            [pageOffset(url)],
          ),
        );
      if (parts.length === 1 && method === "POST")
        return json(
          await saveAsset(
            await readBytes(request, 10 * 1024 * 1024),
            decodeURIComponent(
              request.headers.get("x-filename") || "image",
            ).slice(0, 200),
            actor.name,
          ),
          201,
        );
      if (parts.length === 2 && method === "GET") {
        const [asset] = await (
          await database()
        ).query<Asset>("SELECT * FROM assets WHERE id=$1", [validId(parts[1])]);
        if (!asset) throw new HubError("素材不存在", 404);
        return binary(
          await getBlob(asset.sha256),
          asset.mime,
          url.searchParams.has("download")
            ? asset.name.replace(/\.[^.]+$/, "") + ".webp"
            : undefined,
        );
      }
    }
    if (route === "artifacts" && method === "GET") {
      if (parts.length === 1)
        return json(
          await (
            await database()
          ).query(
            "SELECT a.*,(a.content_version<c.current_version) AS stale FROM artifacts a JOIN contents c ON c.id=a.content_id ORDER BY a.created_at DESC LIMIT 100 OFFSET $1",
            [pageOffset(url)],
          ),
        );
      const [artifact] = await (
        await database()
      ).query<Artifact>("SELECT * FROM artifacts WHERE id=$1", [
        validId(parts[1]),
      ]);
      if (!artifact) throw new HubError("产物不存在", 404);
      if (parts[2] === "download")
        return binary(
          await getBlob(artifact.sha256),
          artifact.mime,
          `${artifact.title}-v${artifact.content_version}-${artifact.variant}.${artifact.recipe.ext || "txt"}`,
        );
      if (parts[2] === "preview")
        return json({
          body: (await getBlob(artifact.sha256)).toString("utf8"),
          mime: artifact.mime,
        });
      return json(artifact);
    }
    if (route === "publications") {
      if (parts.length === 1 && method === "GET")
        return json(
          await (
            await database()
          ).query(
            "SELECT p.*,a.title FROM publications p JOIN artifacts a ON a.id=p.artifact_id ORDER BY p.updated_at DESC LIMIT 100 OFFSET $1",
            [pageOffset(url)],
          ),
        );
      if (parts.length === 1 && method === "POST")
        return json(
          await savePublication(await readJson(request), undefined, actor.name),
          201,
        );
      if (parts.length === 2 && method === "PATCH")
        return json(
          await savePublication(await readJson(request), parts[1], actor.name),
        );
    }
    if (route === "tokens") {
      await authenticate(request, write, true);
      const db = await database();
      if (method === "GET")
        return json(
          await db.query(
            "SELECT id,label,scopes,kind,expires_at,created_at FROM tokens WHERE kind IN ('api','access','refresh') AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 100",
          ),
        );
      if (method === "POST") {
        const body = object(await readJson(request));
        const label = text(body.label, "连接名称", 60);
        const scopes = body.write === true ? [READ, WRITE] : [READ];
        const token = await issueToken("api", label, scopes, 90 * 86400);
        await event(db, "token.created", "owner", token.id, { label, scopes });
        return json({ ...token, scopes, expires_in_days: 90 }, 201);
      }
      if (method === "DELETE" && parts[1]) {
        const [record] = await db.query<{ meta: Record<string, unknown> }>(
          "SELECT meta FROM tokens WHERE id=$1",
          [validId(parts[1])],
        );
        if (record?.meta.family)
          await db.query(
            "UPDATE tokens SET revoked_at=now() WHERE meta->>'family'=$1",
            [record.meta.family],
          );
        else
          await db.query("UPDATE tokens SET revoked_at=now() WHERE id=$1", [
            parts[1],
          ]);
        await event(db, "token.revoked", "owner", parts[1]);
        return json({ ok: true });
      }
    }
    if (route === "oauth" && parts[1] === "authorize") {
      await authenticate(request, write, true);
      const params =
        method === "GET"
          ? url.searchParams
          : new URLSearchParams(
              text(object(await readJson(request)).query, "授权请求", 12000),
            );
      const parsed = validateAuthorization(params);
      let grantedProjects: string[] = [];
      if (parsed.client.agent_id) {
        const [agent] = await (
          await database()
        ).query<{ active: boolean; scopes: string[]; project_ids: string[] }>(
          "SELECT * FROM agents WHERE id=$1",
          [parsed.client.agent_id],
        );
        if (
          !agent?.active ||
          parsed.scopes.some((s) => !agent.scopes.includes(s))
        )
          throw new HubError("OAuth 请求超出已配置 Agent 的授权范围", 403);
        grantedProjects = agent.project_ids;
      }
      if (method === "GET")
        return json({
          name: parsed.client.name,
          scope: parsed.scopes.join(" "),
          project_ids: grantedProjects.length ? grantedProjects : ["default"],
          read_only: !parsed.scopes.some((s) => s.endsWith(":write")),
          redirect_uri: parsed.redirect,
        });
      if (method === "POST") {
        const code = await issueToken(
          "code",
          parsed.client.id,
          parsed.scopes,
          120,
          {
            ...(parsed.client.agent_id
              ? { agent_id: parsed.client.agent_id }
              : {}),
            client_id: parsed.client.id,
            redirect_uri: parsed.redirect,
            code_challenge: parsed.challenge,
            resource: parsed.resource,
          },
        );
        const target = new URL(parsed.redirect);
        target.searchParams.set("code", code.token);
        if (parsed.state) target.searchParams.set("state", parsed.state);
        await event(await database(), "oauth.approved", "owner", code.id, {
          client: parsed.client.id,
          scope: parsed.scopes.join(" "),
        });
        return json({ redirect: target.href });
      }
    }
    if (route === "backup" && method === "GET") {
      await authenticate(request, false, true);
      return binary(
        Buffer.from(JSON.stringify(await exportBackup())),
        "application/json",
        `content-hub-backup-${new Date().toISOString().slice(0, 10)}.json`,
      );
    }
    if (route === "demo" && method === "POST") {
      await authenticate(request, true, true);
      const db = await database();
      if (
        (
          await db.query(
            "SELECT id FROM contents WHERE tags @> ARRAY['示例']::text[] LIMIT 1",
          )
        )[0]
      )
        return json({ ok: true, existing: true });
      const source = await saveSource(
        Buffer.from(
          "这是用于演示工作流的手工示例，不是真实网页抓取。\n来源快照、版本化正文、不可变产物、人工确认发布。",
        ),
        {
          title: "示例 · 内容资产工作流笔记",
          markdown:
            "这是用于演示工作流的手工示例，不是真实网页抓取。\n来源快照、版本化正文、不可变产物、人工确认发布。",
          mime: "text/markdown",
          meta: { demo: true },
        },
        "owner",
      );
      const samples = [
        {
          title: "示例 · 把灵感变成可复用的内容资产",
          status: "ready",
          tags: ["创作方法", "示例"],
          blocks: [
            { type: "heading", text: "别让好想法，消失在聊天记录里。" },
            {
              type: "paragraph",
              text: "一篇文章不应该只有最终发出去的样子。把信息来源、创作过程和每一次产出留在一起，下一次创作就不必从零开始。",
            },
            {
              type: "callout",
              text: "先保存来源，再组织观点，最后为不同平台生成独立产物。",
            },
            {
              type: "image_prompt",
              text: "白色桌面上散落的卡片聚合成一个秩序井然的内容工作台，绿色点缀，3:4 竖版。",
            },
            {
              type: "narration",
              text: "内容不是一次性消耗品。把它变成可以检索、追溯和重组的长期资产。",
            },
          ],
        },
        {
          title: "示例 · 一份正文，面向多个平台",
          status: "draft",
          tags: ["多平台", "示例"],
          blocks: [
            {
              type: "paragraph",
              text: "同一个观点，可以成为长文、图文的提纲，也可以成为一分钟视频的分镜。共用原料，不共用最终产物。",
            },
            {
              type: "code",
              text: "source → content@v1 → artifact → publication",
              lang: "text",
            },
          ],
        },
        {
          title: "示例 · 给每个论断保留一条来时的路",
          status: "draft",
          tags: ["知识管理", "示例"],
          blocks: [
            {
              type: "paragraph",
              text: "链接会变化，快照不会。给正文区块附上来源引用，在几个月后依然能够回答：这句话的依据是什么？",
            },
            {
              type: "quote",
              text: "链接负责指路，快照负责留证。",
              attribution: "示例笔记",
            },
          ],
        },
      ];
      for (const sample of samples) {
        const c = await saveContent({
          ...sample,
          source_ids: [source.id],
          blocks: sample.blocks.map((b) => ({
            ...b,
            id: randomUUID(),
            source_refs: b.type === "paragraph" ? [source.id] : [],
          })),
        });
        if (sample.status === "ready")
          await renderArtifact(c.id, c.version, "html", "web");
      }
      return json({ ok: true }, 201);
    }
    throw new HubError("接口不存在", 404);
  } catch (e) {
    return errorResponse(e);
  }
}
