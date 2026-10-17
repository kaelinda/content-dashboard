"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Code2,
  Copy,
  Download,
  FileJson,
  FileText,
  Image as ImageIcon,
  Layers3,
  LockKeyhole,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Video,
  X,
} from "lucide-react";
import type { Artifact, HubData } from "@/lib/domain";
import {
  Badge,
  downloadFile,
  Empty,
  External,
  formatDate,
  sizeLabel,
  Spinner,
  type Notice,
} from "./ui";
import { PageHeading, PanelTitle } from "./studio";
const kindNames: Record<string, string> = {
  html: "网页文章",
  markdown: "Markdown",
  image: "图片",
  video: "视频",
  image_prompts: "配图提示词",
  storyboard: "视频分镜",
};
const formatIcon = (kind: string) =>
  kind === "html"
    ? Code2
    : kind === "image"
      ? ImageIcon
      : kind === "video"
        ? Video
        : kind === "markdown"
          ? FileText
          : FileJson;
const platforms: Record<string, string> = {
  wechat: "微信公众号",
  x: "X",
  xiaohongshu: "小红书",
  zhihu: "知乎",
  douyin: "抖音",
  other: "其他平台",
};
/** Preview actual bytes, never reinterpret a binary file as a text response. */
function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  const [body, setBody] = useState(""),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setBody("");
    setUrl("");
    setError("");
    setLoading(true);
    fetch("/api/artifacts/" + encodeURIComponent(artifact.id) + "/download", {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("预览读取失败，可重试或下载原文件。");
        const blob = await r.blob();
        if (controller.signal.aborted) return;
        if (
          artifact.mime.startsWith("text/") ||
          artifact.mime === "application/json"
        ) {
          const text = await blob.text();
          if (!controller.signal.aborted) setBody(text);
        } else {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact.id, artifact.mime]);
  if (loading)
    return (
      <div className="studio-preview-loading">
        <Spinner />
        读取原始文件…
      </div>
    );
  if (error)
    return (
      <div className="studio-preview-loading" role="alert">
        {error}
      </div>
    );
  // Source HTML is untrusted: scripts, forms, network loads, frames and navigation are denied.
  const csp =
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; form-action 'none'; base-uri 'none'\">";
  if (artifact.mime.startsWith("text/html"))
    return (
      <iframe
        sandbox=""
        referrerPolicy="no-referrer"
        title={"安全预览 " + artifact.title}
        srcDoc={csp + body}
      />
    );
  if (artifact.mime.startsWith("image/"))
    return <img src={url} alt={artifact.title} />;
  if (artifact.mime.startsWith("video/"))
    return (
      <video
        src={url}
        controls
        preload="metadata"
        aria-label={artifact.title}
      />
    );
  if (body)
    return (
      <pre>
        {body.slice(0, 24000)}
        {body.length > 24000 ? "\n…预览已截断，请下载完整文件。" : ""}
      </pre>
    );
  return (
    <div className="studio-preview-loading">
      <FileText size={36} />
      <p>此格式不在网页中执行。请下载原始文件查看。</p>
    </div>
  );
}
export function ArtifactExplorer({
  data,
  onContent,
  onContents,
  onPublication,
  onPublications,
  notice,
  onMore,
  busy,
}: {
  data: HubData;
  onContent: (id: string) => void;
  onContents: () => void;
  onPublication: (id: string) => void;
  onPublications: () => void;
  notice: Notice;
  onMore: () => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState("all"),
    [state, setState] = useState("all"),
    [selected, setSelected] = useState(""),
    [tab, setTab] = useState("info"),
    [previewKey, setPreviewKey] = useState(0);
  const pane = useRef<HTMLElement>(null);
  const selectedArtifact = data.artifacts.find((a) => a.id === selected);
  const filtered = data.artifacts.filter(
    (a) =>
      (kind === "all" || a.kind === kind) &&
      (state === "all" || (state === "stale" ? a.stale : !a.stale)) &&
      `${a.title} ${a.variant}`.toLowerCase().includes(query.toLowerCase()),
  );
  const kinds = [...new Set(data.artifacts.map((a) => a.kind))];
  const pubs = selectedArtifact
    ? data.publications.filter((p) => p.artifact_id === selectedArtifact.id)
    : [];
  const inspect = (id: string) => {
    setSelected(id);
    setTab("info");
    if (window.innerWidth < 1000)
      requestAnimationFrame(() =>
        pane.current?.scrollIntoView({ block: "start" }),
      );
  };
  return (
    <div className="studio-artifacts">
      <PageHeading
        eyebrow="ARTIFACTS & PUBLICATIONS"
        title="产物与发布中心"
        description="保存真正输出的那一份。每份文件都绑定正文版本，不随后续修改而改变。"
        actions={
          <>
            <button className="button secondary" onClick={onPublications}>
              <Send size={16} />
              发布记录
            </button>
            <button className="button primary" onClick={onContents}>
              <Plus size={17} />
              从内容生成
            </button>
          </>
        }
      />
      <div className="studio-explorer artifact-explorer">
        <section className="studio-panel explorer-list">
          <div className="studio-filter-tabs">
            <button
              aria-pressed={kind === "all"}
              className={kind === "all" ? "active" : ""}
              onClick={() => setKind("all")}
            >
              全部产物 <span>{data.counts.artifacts}</span>
            </button>
            {kinds.map((k) => (
              <button
                key={k}
                aria-pressed={kind === k}
                className={kind === k ? "active" : ""}
                onClick={() => setKind(k)}
              >
                {kindNames[k] ?? k}
              </button>
            ))}
          </div>
          <div className="studio-filter-bar">
            <label className="studio-search">
              <Search size={16} />
              <input
                aria-label="搜索产物"
                placeholder="搜索已载入产物名称或变体…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button aria-label="清空产物搜索" onClick={() => setQuery("")}>
                  <X size={15} />
                </button>
              )}
            </label>
            <select
              aria-label="产物版本筛选"
              value={state}
              onChange={(e) => setState(e.target.value)}
            >
              <option value="all">全部版本</option>
              <option value="current">对应最新正文</option>
              <option value="stale">正文已更新</option>
            </select>
          </div>
          {filtered.length ? (
            <div className="studio-artifact-grid">
              {filtered.map((a) => {
                const Icon = formatIcon(a.kind);
                const registered = data.publications.filter(
                  (p) => p.artifact_id === a.id,
                ).length;
                return (
                  <article
                    key={a.id}
                    className={
                      "artifact-card studio-artifact-card " +
                      (selected === a.id ? "is-selected" : "")
                    }
                  >
                    <button
                      className="artifact-select"
                      aria-pressed={selected === a.id}
                      onClick={() => inspect(a.id)}
                    >
                      <div className={"studio-file-cover format-" + a.kind}>
                        <Icon size={30} strokeWidth={1.4} />
                        <span>{kindNames[a.kind] ?? a.kind}</span>
                        <div className="file-cover-lines">
                          <i />
                          <i />
                          <i />
                        </div>
                      </div>
                      <div className="studio-file-copy">
                        <h3>{a.title}</h3>
                        <p>
                          {kindNames[a.kind] ?? a.kind} · {a.variant}
                        </p>
                        <span className="studio-pill neutral">
                          正文 v{a.content_version}
                        </span>
                        <small>{formatDate(a.created_at)}</small>
                        {a.stale && (
                          <span className="studio-pill warning">
                            正文已有新版本
                          </span>
                        )}
                      </div>
                    </button>
                    <footer>
                      <span>
                        {sizeLabel(a.bytes)} ·{" "}
                        {registered ? `${registered} 条发布登记` : "未登记发布"}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => onPublication(a.id)}
                      >
                        记录发布
                        <ArrowUpRight size={13} />
                      </button>
                    </footer>
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty
              title={
                query || kind !== "all" || state !== "all"
                  ? "没有匹配的产物"
                  : "你的输出，值得被完整留下"
              }
              description="保存一篇内容后生成产物，或让 Agent 上传实际文件并登记。"
              action={
                <button className="button secondary" onClick={onContents}>
                  前往内容库
                  <ArrowRight size={15} />
                </button>
              }
            />
          )}
          <div className="studio-list-footer">
            <span>
              显示 {filtered.length} / 已载入 {data.artifacts.length} 条
            </span>
            {data.artifacts.length < data.counts.artifacts && (
              <button className="text-button" disabled={busy} onClick={onMore}>
                加载更多
                <ArrowRight size={15} />
              </button>
            )}
          </div>
        </section>
        <aside
          className="studio-panel explorer-detail"
          ref={pane}
          aria-label="产物详情"
        >
          {!selectedArtifact ? (
            <div className="studio-detail-placeholder">
              <span className="studio-icon tone-violet">
                <Layers3 size={30} />
              </span>
              <h2>一份内容，多种表达。</h2>
              <p>选择一份产物，检查真实输出、绑定版本与发布记录。</p>
              <div className="studio-placeholder-lines">
                <i />
                <i />
                <i />
              </div>
              <span className="studio-pill neutral">
                <LockKeyhole size={13} />
                只新增，不覆盖
              </span>
            </div>
          ) : (
            <>
              <div className="studio-detail-top">
                <span className="studio-icon tone-green">
                  <Layers3 size={22} />
                </span>
                <div>
                  <h2>{selectedArtifact.title}</h2>
                  <small>
                    {kindNames[selectedArtifact.kind] ?? selectedArtifact.kind}{" "}
                    · 正文 v{selectedArtifact.content_version}
                  </small>
                </div>
                <button
                  aria-label="关闭产物详情"
                  className="icon-button"
                  onClick={() => setSelected("")}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="studio-artifact-preview" key={previewKey}>
                <ArtifactPreview artifact={selectedArtifact} />
              </div>
              <div className="studio-preview-caption">
                <ShieldCheck size={13} />
                原始文件安全预览
                <button
                  className="text-button"
                  onClick={() => setPreviewKey((n) => n + 1)}
                >
                  重新载入
                </button>
              </div>
              <div className="studio-filter-tabs">
                {[
                  ["info", "基本信息"],
                  ["recipe", "生成记录"],
                  ["publications", "发布登记"],
                ].map(([v, l]) => (
                  <button
                    aria-pressed={tab === v}
                    className={tab === v ? "active" : ""}
                    key={v}
                    onClick={() => setTab(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <div className="studio-detail-body">
                {tab === "info" && (
                  <>
                    {selectedArtifact.stale && (
                      <div className="studio-note warning">
                        正文已有新版本。这份文件仍绑定 v
                        {selectedArtifact.content_version}，不会被自动覆盖。
                      </div>
                    )}
                    <dl className="studio-dl">
                      <div>
                        <dt>文件类型</dt>
                        <dd>{selectedArtifact.mime}</dd>
                      </div>
                      <div>
                        <dt>文件大小</dt>
                        <dd>{sizeLabel(selectedArtifact.bytes)}</dd>
                      </div>
                      <div>
                        <dt>创建时间</dt>
                        <dd>{formatDate(selectedArtifact.created_at)}</dd>
                      </div>
                      <div>
                        <dt>来源内容</dt>
                        <dd>
                          <button
                            className="text-button"
                            onClick={() =>
                              onContent(selectedArtifact.content_id)
                            }
                          >
                            查看当前正文
                            <ArrowUpRight size={13} />
                          </button>
                        </dd>
                      </div>
                      <div>
                        <dt>绑定版本</dt>
                        <dd>v{selectedArtifact.content_version} · 已冻结</dd>
                      </div>
                    </dl>
                    <details className="studio-technical">
                      <summary>完整性与资源标识</summary>
                      <span>SHA-256</span>
                      <code>{selectedArtifact.sha256}</code>
                      <button
                        className="text-button"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(selectedArtifact.sha256)
                            .then(() => notice("摘要已复制"))
                            .catch(() =>
                              notice("复制失败，请选择文本复制。", true),
                            )
                        }
                      >
                        <Copy size={13} />
                        复制摘要
                      </button>
                      <span>Artifact ID</span>
                      <code>{selectedArtifact.id}</code>
                    </details>
                  </>
                )}
                {tab === "recipe" && (
                  <>
                    <p className="studio-sub">
                      认证身份以服务器记录为准，生成器名称等自报信息不代表已核实。
                    </p>
                    <pre className="studio-json">
                      {JSON.stringify(selectedArtifact.recipe, null, 2)}
                    </pre>
                  </>
                )}
                {tab === "publications" && (
                  <>
                    <div className="studio-note">
                      这里是人工登记，不会自动向外部平台发文。
                    </div>
                    {pubs.length ? (
                      pubs.map((p) => (
                        <div className="studio-publication" key={p.id}>
                          <span className="studio-icon tone-green">
                            <Send size={18} />
                          </span>
                          <div>
                            <strong>
                              {platforms[p.platform] ?? p.platform}
                            </strong>
                            <small>{formatDate(p.updated_at)}</small>
                            {p.url && <External url={p.url}>查看原文</External>}
                          </div>
                          <Badge value={p.status} />
                        </div>
                      ))
                    ) : (
                      <p className="studio-sub">
                        已载入记录中，尚未找到这份文件的发布登记。
                      </p>
                    )}
                  </>
                )}
                <div className="studio-detail-actions">
                  <button
                    className="button secondary"
                    onClick={() =>
                      void downloadFile(
                        "artifacts/" + selectedArtifact.id + "/download",
                      ).catch((e) => notice(e.message, true))
                    }
                  >
                    <Download size={16} />
                    下载原文件
                  </button>
                  <button
                    className="button primary"
                    onClick={() => onPublication(selectedArtifact.id)}
                  >
                    <Send size={16} />
                    登记发布
                  </button>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
      <section className="studio-panel studio-publication-summary">
        <PanelTitle
          title="最近发布登记"
          aside={
            <button className="text-button" onClick={onPublications}>
              查看全部
              <ArrowRight size={15} />
            </button>
          }
        />
        {data.publications.length ? (
          <div className="studio-table-scroll">
            <table className="studio-table">
              <thead>
                <tr>
                  <th>产物</th>
                  <th>渠道</th>
                  <th>状态</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {data.publications.slice(0, 4).map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.title}</strong>
                    </td>
                    <td>{platforms[p.platform] ?? p.platform}</td>
                    <td>
                      <Badge value={p.status} />
                    </td>
                    <td>{formatDate(p.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="studio-quiet">
            <Send size={24} />
            <p>在外部平台完成发布后，登记真实链接，留下一份可追溯记录。</p>
          </div>
        )}
        <p className="studio-panel-footnote">
          未连接平台分析接口，不展示推测的曝光量、点击量或互动率。
        </p>
      </section>
    </div>
  );
}
