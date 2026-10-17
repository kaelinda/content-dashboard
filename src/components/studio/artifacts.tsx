"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Code2,
  Download,
  FileText,
  Image as ImageIcon,
  Layers3,
  LockKeyhole,
  Package,
  Plus,
  Send,
  X,
} from "lucide-react";
import type { Artifact, HubData } from "@/lib/domain";
import {
  Badge,
  downloadFile,
  Empty,
  Spinner,
  sizeLabel,
  type Notice,
} from "../ui";
import {
  CopyButton,
  PageHeading,
  PanelHeading,
  QueryInput,
  platformLabels,
  safeDate,
  safeUrl,
} from "./shared";
const kindName = (a: Artifact) =>
  ({
    html: "网页排版稿",
    markdown: "Markdown",
    image: "图片",
    video: "视频",
    image_prompt: "配图提示词",
    storyboard: "分镜脚本",
  })[a.kind] ?? a.kind;
export function FileGlyph({
  artifact,
  large = false,
}: {
  artifact: Artifact;
  large?: boolean;
}) {
  const Icon =
    artifact.kind === "html"
      ? Code2
      : artifact.kind === "markdown"
        ? FileText
        : artifact.kind === "image"
          ? ImageIcon
          : Layers3;
  return (
    <div
      className={`studio-file-glyph glyph-${artifact.kind} ${large ? "large" : ""}`}
    >
      <div className="file-glyph-paper">
        <Icon size={large ? 30 : 24} strokeWidth={1.5} />
        <span />
        <span />
        <span />
      </div>
      <strong>
        {artifact.kind === "markdown" ? "MD" : artifact.kind.toUpperCase()}
      </strong>
    </div>
  );
}
// Previews are bounded, private and never execute uploaded HTML. Remote embeds are blocked.
function SafeArtifactPreview({ artifact }: { artifact: Artifact }) {
  const [preview, setPreview] = useState<{
    text?: string;
    url?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const textType = /^(text\/|application\/json)/.test(artifact.mime);
  const imageType = /^image\/(png|jpeg|webp)$/.test(artifact.mime);
  const supported =
    artifact.bytes <= 2 * 1024 * 1024 && (textType || imageType);
  useEffect(() => {
    setPreview(null);
    setError("");
    if (!supported) return;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    void fetch(`/api/artifacts/${encodeURIComponent(artifact.id)}/download`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("预览加载失败。可以重试或下载原文件。");
        const blob = await response.blob();
        if (blob.size > 2 * 1024 * 1024)
          throw new Error("文件超过预览大小限制，请下载原文件。");
        if (textType) {
          const text = await blob.text();
          if (!controller.signal.aborted) setPreview({ text });
        } else if (!controller.signal.aborted) {
          objectUrl = URL.createObjectURL(blob);
          setPreview({ url: objectUrl });
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact.id, artifact.mime, supported, textType, retry]);
  if (!supported)
    return (
      <div className="studio-preview-unavailable">
        <FileGlyph artifact={artifact} large />
        <strong>{kindName(artifact)}</strong>
        <p>此格式或大小不提供内嵌预览。原文件仍可完整下载。</p>
      </div>
    );
  if (error)
    return (
      <div className="inline-error" role="alert">
        {error}
        <button className="text-button" onClick={() => setRetry((n) => n + 1)}>
          重新加载预览
        </button>
      </div>
    );
  if (!preview)
    return (
      <div className="studio-loading">
        <Spinner />
        正在读取真实文件…
      </div>
    );
  if (preview.url)
    return (
      <img
        className="studio-artifact-image"
        src={preview.url}
        alt={artifact.title}
      />
    );
  if (artifact.mime.startsWith("text/html"))
    return (
      <iframe
        className="studio-html-preview"
        title="安全产物预览"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={
          "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'\"><style>body{font-family:system-ui,sans-serif;margin:20px;color:#20372b}img{max-width:100%}pre{white-space:pre-wrap}</style>" +
          preview.text
        }
      />
    );
  return <pre className="studio-code-preview">{preview.text}</pre>;
}
export function ArtifactBrowser({
  data,
  onContent,
  onContents,
  onPublication,
  onMore,
  busy,
  notice,
}: {
  data: HubData;
  onContent: (id: string) => void;
  onContents: () => void;
  onPublication: (id: string) => void;
  onMore: () => void;
  busy: boolean;
  notice: Notice;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [freshness, setFreshness] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState("info");
  const [mobileDetail, setMobileDetail] = useState(false);
  const filtered = data.artifacts.filter(
    (a) =>
      (type === "all" || a.kind === type) &&
      (freshness === "all" || (freshness === "stale" ? a.stale : !a.stale)) &&
      `${a.title} ${a.variant} ${a.kind}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const selected = filtered.find((a) => a.id === selectedId) ?? filtered[0];
  const kinds = Array.from(new Set(data.artifacts.map((a) => a.kind)));
  const publications = selected
    ? data.publications.filter((p) => p.artifact_id === selected.id)
    : [];
  const content = data.contents.find((c) => c.id === selected?.content_id);
  return (
    <div className="studio-artifacts">
      <PageHeading
        eyebrow="ARTIFACTS & PUBLICATIONS"
        title="产物与发布中心"
        description="保存真正输出的那一份。将每份文件关联到正文版本与发布记录。"
        actions={
          <button className="button primary" onClick={onContents}>
            <Plus size={17} />
            从内容生成
          </button>
        }
      />
      <div className="studio-info-banner">
        <LockKeyhole size={17} />
        <span>
          文件只新增、不覆盖。发布记录由你登记，不会自动向外部平台发文。
        </span>
      </div>
      <div
        className={`studio-split artifact-split ${mobileDetail ? "detail-open" : ""}`}
      >
        <section className="studio-panel studio-browser-list">
          <div className="studio-filter-tabs" aria-label="产物格式筛选">
            <button
              className={type === "all" ? "active" : ""}
              aria-pressed={type === "all"}
              onClick={() => setType("all")}
            >
              全部产物<span>{data.artifacts.length}</span>
            </button>
            {kinds.map((kind) => (
              <button
                key={kind}
                className={type === kind ? "active" : ""}
                aria-pressed={type === kind}
                onClick={() => setType(kind)}
              >
                {kind === "html"
                  ? "网页文章"
                  : kind === "markdown"
                    ? "Markdown"
                    : kind}
                <span>
                  {data.artifacts.filter((a) => a.kind === kind).length}
                </span>
              </button>
            ))}
          </div>
          <div className="studio-browser-toolbar">
            <QueryInput
              label="搜索产物"
              placeholder="搜索已载入的产物名称、格式…"
              value={query}
              onChange={setQuery}
            />
            <select
              aria-label="产物版本筛选"
              value={freshness}
              onChange={(e) => setFreshness(e.target.value)}
            >
              <option value="all">全部版本</option>
              <option value="current">正文未更新</option>
              <option value="stale">正文已有新版</option>
            </select>
          </div>
          {filtered.length ? (
            <div className="studio-artifact-grid">
              {filtered.map((a) => (
                <article
                  key={a.id}
                  className={`artifact-card studio-artifact-card ${selected?.id === a.id ? "selected" : ""}`}
                >
                  <button
                    className="artifact-select"
                    aria-label={`查看产物 ${a.title} ${a.variant}`}
                    aria-pressed={selected?.id === a.id}
                    onClick={() => {
                      setSelectedId(a.id);
                      setMobileDetail(true);
                    }}
                  >
                    <FileGlyph artifact={a} />
                    <div>
                      <h3>{a.title}</h3>
                      <p>
                        {kindName(a)} · {a.variant}
                      </p>
                      <div className="studio-chip-wrap">
                        <span className="studio-chip neutral">
                          正文 v{a.content_version}
                        </span>
                        <span className="studio-chip blue">
                          {sizeLabel(a.bytes)}
                        </span>
                      </div>
                      <small>{safeDate(a.created_at)}</small>
                    </div>
                  </button>
                  {a.stale && (
                    <div className="studio-stale">正文已有新版本</div>
                  )}
                  <div className="studio-artifact-card-actions">
                    <span className="studio-chip">
                      <LockKeyhole size={11} />
                      已冻结
                    </span>
                    <button
                      className="text-button"
                      onClick={() => onPublication(a.id)}
                    >
                      记录发布 <ArrowUpRight size={13} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty
              title={
                data.artifacts.length
                  ? "没有符合筛选的产物"
                  : "把内容变成可复用的输出"
              }
              description={
                data.artifacts.length
                  ? "调整关键词或版本筛选条件。"
                  : "先保存正文，再生成网页、Markdown、提示词或分镜脚本；外部 Agent 也可上传文件并登记产物。"
              }
              action={
                <button
                  className="button secondary"
                  onClick={() => {
                    if (data.artifacts.length) {
                      setQuery("");
                      setType("all");
                      setFreshness("all");
                    } else onContents();
                  }}
                >
                  {data.artifacts.length ? "清除产物筛选" : "前往内容库"}
                  <ArrowRight size={15} />
                </button>
              }
            />
          )}
          <div className="studio-panel-foot">
            已载入 {data.artifacts.length} / {data.counts.artifacts} 条
            {data.artifacts.length < data.counts.artifacts && (
              <button className="text-button" onClick={onMore} disabled={busy}>
                加载更多产物
              </button>
            )}
          </div>
        </section>
        <aside className="studio-panel studio-inspector" aria-label="产物详情">
          <div className="studio-inspector-head">
            <div>
              <span className="studio-eyebrow">IMMUTABLE OUTPUT</span>
              <h2>{selected?.title ?? "产物详情"}</h2>
            </div>
            <button
              className="icon-button mobile-detail-close"
              aria-label="返回产物列表"
              onClick={() => setMobileDetail(false)}
            >
              <X size={18} />
            </button>
          </div>
          {selected ? (
            <>
              <div className="studio-artifact-preview">
                <SafeArtifactPreview key={selected.id} artifact={selected} />
              </div>
              <div className="studio-filter-tabs">
                <button
                  className={tab === "info" ? "active" : ""}
                  aria-pressed={tab === "info"}
                  onClick={() => setTab("info")}
                >
                  基本信息
                </button>
                <button
                  className={tab === "publications" ? "active" : ""}
                  aria-pressed={tab === "publications"}
                  onClick={() => setTab("publications")}
                >
                  发布记录<span>{publications.length}</span>
                </button>
                <button
                  className={tab === "recipe" ? "active" : ""}
                  aria-pressed={tab === "recipe"}
                  onClick={() => setTab("recipe")}
                >
                  生成配置
                </button>
              </div>
              <div className="studio-inspector-body">
                {tab === "info" && (
                  <>
                    <dl className="studio-facts">
                      <div>
                        <dt>产物格式</dt>
                        <dd>
                          <span className="studio-chip blue">
                            {selected.kind.toUpperCase()}
                          </span>{" "}
                          {selected.variant}
                        </dd>
                      </div>
                      <div>
                        <dt>绑定正文</dt>
                        <dd>
                          <button
                            className="text-button"
                            onClick={() => onContent(selected.content_id)}
                          >
                            {content?.title ?? selected.title}
                            <ArrowUpRight size={14} />
                          </button>
                        </dd>
                      </div>
                      <div>
                        <dt>正文版本</dt>
                        <dd>
                          v{selected.content_version}
                          {selected.stale && (
                            <span className="studio-chip amber">
                              正文已有新版
                            </span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>文件大小</dt>
                        <dd>{sizeLabel(selected.bytes)}</dd>
                      </div>
                      <div>
                        <dt>生成时间</dt>
                        <dd>{safeDate(selected.created_at)}</dd>
                      </div>
                      <div>
                        <dt>留存方式</dt>
                        <dd>原始字节 · 私有访问</dd>
                      </div>
                    </dl>
                    <details className="studio-technical">
                      <summary>文件摘要与资源 ID</summary>
                      <code>SHA-256 {selected.sha256}</code>
                      <div className="copy-line">
                        <code>{selected.id}</code>
                        <CopyButton
                          value={selected.id}
                          label="复制产物 ID"
                          notice={notice}
                        />
                      </div>
                    </details>
                  </>
                )}
                {tab === "publications" && (
                  <div>
                    {publications.length ? (
                      publications.map((p) => (
                        <div className="studio-publication-line" key={p.id}>
                          <Send size={17} />
                          <div>
                            <strong>
                              {platformLabels[p.platform] ?? p.platform}
                            </strong>
                            <small>
                              {safeDate(p.published_at ?? p.created_at)}
                            </small>
                            {safeUrl(p.url) && (
                              <a
                                href={safeUrl(p.url)!}
                                target="_blank"
                                rel="noreferrer"
                              >
                                查看登记链接 <ArrowUpRight size={13} />
                              </a>
                            )}
                          </div>
                          <Badge value={p.status} />
                        </div>
                      ))
                    ) : (
                      <p className="muted">
                        暂无登记记录。这不代表该文件从未在外部发布。
                      </p>
                    )}
                    <p className="studio-caption">
                      记录来自人工登记，不代表平台已通过 API 确认。
                    </p>
                  </div>
                )}
                {tab === "recipe" && (
                  <>
                    <p className="studio-caption">
                      生成配方是留存元信息。执行器自报字段不等于经过认证的模型身份。
                    </p>
                    <pre className="studio-code-preview">
                      {JSON.stringify(selected.recipe, null, 2)}
                    </pre>
                  </>
                )}
                <div className="studio-inspector-actions">
                  <button
                    className="button secondary"
                    onClick={() =>
                      void downloadFile(
                        `artifacts/${selected.id}/download`,
                      ).catch((e) => notice(e.message, true))
                    }
                  >
                    <Download size={16} />
                    下载原文件
                  </button>
                  <button
                    className="button primary"
                    onClick={() => onPublication(selected.id)}
                  >
                    <Send size={15} />
                    登记发布
                  </button>
                </div>
              </div>
            </>
          ) : (
            <Empty
              title="每一份输出，都有来处"
              description="选择左侧产物，查看真实预览、正文版本和发布记录。"
            />
          )}
        </aside>
      </div>
      <section className="studio-panel studio-publications-summary">
        <PanelHeading
          title="最近发布记录"
          action={
            <span className="studio-caption">当前已载入记录 · 人工登记</span>
          }
        />
        {data.publications.length ? (
          <div className="studio-table-scroll">
            <table className="studio-table">
              <thead>
                <tr>
                  <th>产物名称</th>
                  <th>发布渠道</th>
                  <th>状态</th>
                  <th>登记时间</th>
                  <th>链接</th>
                </tr>
              </thead>
              <tbody>
                {data.publications.slice(0, 5).map((p) => (
                  <tr key={p.id}>
                    <td>{p.title}</td>
                    <td>{platformLabels[p.platform] ?? p.platform}</td>
                    <td>
                      <Badge value={p.status} />
                    </td>
                    <td>{safeDate(p.created_at)}</td>
                    <td>
                      {safeUrl(p.url) ? (
                        <a
                          href={safeUrl(p.url)!}
                          target="_blank"
                          rel="noreferrer"
                        >
                          查看链接 <ArrowUpRight size={13} />
                        </a>
                      ) : (
                        "未登记链接"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="studio-empty-compact">
            暂无发布记录。完成外部发布后，在这里登记对应产物与链接。
          </div>
        )}
      </section>
    </div>
  );
}
