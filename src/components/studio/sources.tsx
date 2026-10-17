"use client";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Download,
  FileText,
  FileUp,
  Link2,
  Plus,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import type { HubData, Source, Content } from "@/lib/domain";
import { downloadFile, Empty, Spinner, Badge, type Notice } from "../ui";
import {
  CopyButton,
  Metric,
  PageHeading,
  PanelHeading,
  QueryInput,
  domainLabel,
  safeDate,
  safeUrl,
} from "./shared";
export type SourceMode = "url" | "manual" | "file";
type SourceWithRelations = Source & {
  related_contents?: Content[];
  locations?: { url: string }[];
  images?: { asset_id: string; width: number; height: number; alt: string }[];
};
export function SourceBrowser({
  data,
  onImport,
  onCreate,
  onContent,
  onMore,
  busy,
  notice,
}: {
  data: HubData;
  onImport: (mode: SourceMode) => void;
  onCreate: (s: Source) => void;
  onContent: (id: string) => void;
  onMore: () => void;
  busy: boolean;
  notice: Notice;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [order, setOrder] = useState("newest");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<SourceWithRelations | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState("overview");
  const [mobileDetail, setMobileDetail] = useState(false);
  const kind = (s: Source) =>
    s.meta?.import === "file" ? "file" : s.original_url ? "url" : "text";
  const filtered = data.sources
    .filter(
      (s) =>
        (type === "all" || kind(s) === type) &&
        `${s.title} ${s.original_url ?? ""} ${s.markdown}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) =>
      order === "oldest"
        ? Date.parse(a.fetched_at) - Date.parse(b.fetched_at)
        : order === "title"
          ? a.title.localeCompare(b.title, "zh-CN")
          : Date.parse(b.fetched_at) - Date.parse(a.fetched_at),
    );
  const selected = filtered.find((s) => s.id === selectedId) ?? filtered[0];
  useEffect(() => {
    setDetail(null);
    setError("");
    if (!selected) return;
    const controller = new AbortController();
    void fetch("/api/sources/" + encodeURIComponent(selected.id), {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "无法读取来源");
        return body as SourceWithRelations;
      })
      .then(setDetail)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [selected?.id, data.sources, retry]);
  const linked = data.sources.filter((s) => !!s.original_url).length;
  const warningList = Array.isArray(detail?.meta?.warnings)
    ? (detail.meta.warnings.filter((v) => typeof v === "string") as string[])
    : [];
  return (
    <div className="studio-sources">
      <PageHeading
        eyebrow="SOURCES & EVIDENCE"
        title="资料采集中心"
        description="保存来源与原始快照，为每一篇内容留下可回溯的依据。"
        actions={
          <button className="button primary" onClick={() => onImport("url")}>
            <Plus size={17} />
            保存来源
          </button>
        }
      />
      <div className="studio-capture-actions">
        <button onClick={() => onImport("url")}>
          <span className="studio-icon tone-green">
            <Link2 size={23} />
          </span>
          <span>
            <strong>保存链接</strong>
            <small>采集公开网页与原始快照</small>
          </span>
          <ArrowUpRight size={16} />
        </button>
        <button onClick={() => onImport("manual")}>
          <span className="studio-icon tone-violet">
            <FileText size={23} />
          </span>
          <span>
            <strong>粘贴资料</strong>
            <small>留存已获取的原文与出处</small>
          </span>
          <ArrowUpRight size={16} />
        </button>
        <button onClick={() => onImport("file")}>
          <span className="studio-icon tone-teal">
            <FileUp size={23} />
          </span>
          <span>
            <strong>上传文件</strong>
            <small>HTML / Markdown / TXT / PDF</small>
          </span>
          <ArrowUpRight size={16} />
        </button>
        <a href="/docs/agents" target="_blank" rel="noreferrer">
          <span className="studio-icon tone-sage">
            <Terminal size={23} />
          </span>
          <span>
            <strong>通过 Agent 写入</strong>
            <small>统一 REST 与 MCP 接口</small>
          </span>
          <ArrowUpRight size={16} />
        </a>
      </div>
      <div className="studio-metrics source-metrics">
        <Metric
          icon={BookOpen}
          label="信息源总数"
          value={data.counts.sources}
          note="仓库中的实际来源记录"
        />
        <Metric
          icon={Link2}
          label="保留原始链接"
          value={linked}
          note={`在已载入的 ${data.sources.length} 条中`}
          tone="blue"
        />
        <Metric
          icon={FileText}
          label="文件快照"
          value={data.sources.filter((s) => kind(s) === "file").length}
          note={`在已载入的 ${data.sources.length} 条中`}
          tone="violet"
        />
        <Metric
          icon={ShieldCheck}
          label="原始快照"
          value="可追溯"
          note="留存原文 ≠ 已完成事实核验"
          tone="sage"
        />
      </div>
      <div
        className={`studio-split source-split ${mobileDetail ? "detail-open" : ""}`}
      >
        <section className="studio-panel studio-browser-list">
          <div className="studio-filter-tabs" aria-label="来源类型筛选">
            {[
              ["all", "全部来源"],
              ["url", "网页链接"],
              ["text", "文本资料"],
              ["file", "文件快照"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={type === id ? "active" : ""}
                aria-pressed={type === id}
                onClick={() => {
                  setType(id);
                  setMobileDetail(false);
                }}
              >
                {label}
                <span>
                  {
                    data.sources.filter((s) => id === "all" || kind(s) === id)
                      .length
                  }
                </span>
              </button>
            ))}
          </div>
          <div className="studio-browser-toolbar">
            <QueryInput
              label="搜索来源"
              placeholder="搜索已载入的名称、网址或摘要…"
              value={query}
              onChange={setQuery}
            />
            <select
              aria-label="来源排序"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
            >
              <option value="newest">最近添加</option>
              <option value="oldest">最早添加</option>
              <option value="title">按标题</option>
            </select>
          </div>
          {filtered.length ? (
            <div className="studio-table-scroll">
              <table className="studio-table source-table">
                <thead>
                  <tr>
                    <th>信息源</th>
                    <th>类型</th>
                    <th>采集时间</th>
                    <th>快照</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((source) => (
                    <tr
                      key={source.id}
                      className={source.id === selected?.id ? "selected" : ""}
                    >
                      <td>
                        <button
                          className="studio-identity source-select"
                          aria-pressed={source.id === selected?.id}
                          onClick={() => {
                            setSelectedId(source.id);
                            setMobileDetail(true);
                            setTab("overview");
                          }}
                        >
                          <span
                            className={`studio-icon small tone-${kind(source) === "file" ? "violet" : "green"}`}
                          >
                            {kind(source) === "url" ? (
                              <Link2 size={19} />
                            ) : (
                              <FileText size={19} />
                            )}
                          </span>
                          <span>
                            <strong>{source.title}</strong>
                            <small>{domainLabel(source.original_url)}</small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <span
                          className={`studio-chip ${kind(source) === "file" ? "violet" : "blue"}`}
                        >
                          {kind(source) === "url"
                            ? "网页"
                            : kind(source) === "file"
                              ? "文件"
                              : "文本"}
                        </span>
                      </td>
                      <td>{safeDate(source.fetched_at)}</td>
                      <td>
                        <span className="studio-status enabled">
                          <i />
                          已留存
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={
                data.sources.length
                  ? "没有符合筛选的来源"
                  : "第一份资料，从这里开始"
              }
              description={
                data.sources.length
                  ? "换个关键词或清除筛选条件。全库搜索可使用顶部搜索框。"
                  : "粘贴原文，或保存一个公开链接。系统会留存快照，供不同 Agent 复用。"
              }
              action={
                <button
                  className="button secondary"
                  onClick={() => {
                    setQuery("");
                    setType("all");
                    if (!data.sources.length) onImport("manual");
                  }}
                >
                  {data.sources.length ? "清除筛选" : "粘贴第一份资料"}
                </button>
              }
            />
          )}
          <div className="studio-panel-foot">
            <span>
              已载入 {data.sources.length} / {data.counts.sources} 条 ·
              筛选当前已载入记录
            </span>
            {data.sources.length < data.counts.sources && (
              <button className="text-button" disabled={busy} onClick={onMore}>
                加载更多来源
              </button>
            )}
          </div>
        </section>
        <aside className="studio-panel studio-inspector" aria-label="来源详情">
          <div className="studio-inspector-head">
            <div>
              <span className="studio-eyebrow">SOURCE SNAPSHOT</span>
              <h2>{selected?.title ?? "来源详情"}</h2>
              <span className="muted">
                {selected
                  ? domainLabel(selected.original_url)
                  : "选择一条记录查看"}
              </span>
            </div>
            <button
              className="icon-button mobile-detail-close"
              aria-label="返回来源列表"
              onClick={() => setMobileDetail(false)}
            >
              <X size={18} />
            </button>
          </div>
          {selected ? (
            <>
              <div className="studio-filter-tabs">
                <button
                  className={tab === "overview" ? "active" : ""}
                  aria-pressed={tab === "overview"}
                  onClick={() => setTab("overview")}
                >
                  概览
                </button>
                <button
                  className={tab === "text" ? "active" : ""}
                  aria-pressed={tab === "text"}
                  onClick={() => setTab("text")}
                >
                  原文内容
                </button>
                <button
                  className={tab === "related" ? "active" : ""}
                  aria-pressed={tab === "related"}
                  onClick={() => setTab("related")}
                >
                  关联内容
                </button>
              </div>
              {error ? (
                <div role="alert" className="inline-error">
                  {error}
                  <button
                    className="text-button"
                    onClick={() => setRetry((n) => n + 1)}
                  >
                    重试读取
                  </button>
                </div>
              ) : !detail ? (
                <div className="studio-loading">
                  <Spinner />
                  读取原始记录…
                </div>
              ) : (
                <div className="studio-inspector-body">
                  {tab === "overview" && (
                    <>
                      <section className="detail-section">
                        <h3>原始链接</h3>
                        {safeUrl(detail.original_url) ? (
                          <a
                            className="studio-url"
                            href={safeUrl(detail.original_url)!}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Link2 size={15} />
                            <span>{detail.original_url}</span>
                            <ArrowUpRight size={16} />
                          </a>
                        ) : (
                          <p className="muted">
                            直接导入的文本或文件，没有外部链接。
                          </p>
                        )}
                        <h3>资料摘要</h3>
                        <p className="source-excerpt">
                          {detail.markdown.slice(0, 380)}
                          {detail.markdown.length > 380 ? "…" : ""}
                        </p>
                        <button
                          className="text-button"
                          onClick={() => setTab("text")}
                        >
                          阅读已保存原文 <ArrowRightIcon />
                        </button>
                      </section>
                      <section className="detail-section">
                        <h3>快照信息</h3>
                        <dl className="studio-facts">
                          <div>
                            <dt>保存时间</dt>
                            <dd>{safeDate(detail.fetched_at)}</dd>
                          </div>
                          <div>
                            <dt>可信度标记</dt>
                            <dd>
                              {detail.trust_level === "high"
                                ? "人工标记：高"
                                : detail.trust_level === "low"
                                  ? "人工标记：低"
                                  : "未核实 / 需交叉验证"}
                            </dd>
                          </div>
                          <div>
                            <dt>来源类型</dt>
                            <dd>
                              {kind(detail) === "file"
                                ? "文件快照"
                                : kind(detail) === "url"
                                  ? "带原始链接"
                                  : "文本资料"}
                            </dd>
                          </div>
                        </dl>
                        <p className="studio-caption">
                          来源关联和可信度标记不代表已核验其中的事实。
                        </p>
                        {warningList.length > 0 && (
                          <div className="inline-note">
                            {warningList.join("；")}
                          </div>
                        )}
                        <details className="studio-technical">
                          <summary>查看快照摘要与资源 ID</summary>
                          <code>{detail.sha256}</code>
                          <div className="copy-line">
                            <code>{detail.id}</code>
                            <CopyButton
                              value={detail.id}
                              label="复制来源 ID"
                              notice={notice}
                            />
                          </div>
                        </details>
                      </section>
                    </>
                  )}
                  {tab === "text" && (
                    <section className="detail-section">
                      <h3>已归档的原文</h3>
                      <pre className="studio-source-text">
                        {detail.markdown}
                      </pre>
                    </section>
                  )}
                  {tab === "related" && (
                    <section className="detail-section">
                      <h3>当前版本引用此来源的内容（最多 100 条）</h3>
                      {detail.related_contents?.length ? (
                        detail.related_contents.map((c) => (
                          <button
                            key={c.id}
                            className="studio-related-row"
                            onClick={() => onContent(c.id)}
                          >
                            <FileText size={18} />
                            <span>
                              <strong>{c.title}</strong>
                              <small>
                                v{c.current_version} · {safeDate(c.updated_at)}
                              </small>
                            </span>
                            <Badge value={c.status} />
                          </button>
                        ))
                      ) : (
                        <p className="muted">
                          尚无正文当前版本关联此来源。历史引用仍保留在各内容版本中。
                        </p>
                      )}
                    </section>
                  )}
                  <div className="studio-inspector-actions">
                    <button
                      className="button secondary"
                      onClick={() =>
                        void downloadFile(
                          "sources/" + detail.id + "/snapshot",
                        ).catch((e) => notice(e.message, true))
                      }
                    >
                      <Download size={15} />
                      下载快照
                    </button>
                    <button
                      className="button primary"
                      onClick={() => onCreate(detail)}
                    >
                      <Plus size={15} />
                      基于此来源创建
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <Empty
              title="资料与证据，放在一起"
              description="选择左侧来源，查看已保存原文、快照和关联内容。"
            />
          )}
        </aside>
      </div>
    </div>
  );
}
function ArrowRightIcon() {
  return <ArrowUpRight size={14} />;
}
