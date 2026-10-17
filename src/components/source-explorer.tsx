"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Clock3,
  FileText,
  Link2,
  Plus,
  Search,
  ShieldCheck,
  Upload,
  X,
  Download,
  Code2,
} from "lucide-react";
import type { HubData, Source } from "@/lib/domain";
import {
  api,
  Badge,
  downloadFile,
  Empty,
  External,
  formatDate,
  Spinner,
  type Notice,
} from "./ui";
import {
  domainOf,
  Metric,
  PageHeading,
  PanelTitle,
  type StudioData,
} from "./studio";
export type CaptureMode = "url" | "manual" | "file";
type Detail = {
  source: Source;
  related: {
    id: string;
    title: string;
    current_version: number;
    status: string;
  }[];
  has_more: boolean;
};
export function SourceExplorer({
  data,
  onImport,
  onCreate,
  onOpenContent,
  onFullSource,
  notice,
  onMore,
  busy,
}: {
  data: HubData;
  onImport: (mode: CaptureMode) => void;
  onCreate: (s: Source) => void;
  onOpenContent: (id: string) => void;
  onFullSource: (id: string) => void;
  notice: Notice;
  onMore: () => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState(""),
    [type, setType] = useState("all"),
    [order, setOrder] = useState("newest"),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<Detail | null>(null),
    [tab, setTab] = useState<"overview" | "text" | "related">("overview"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [stats, setStats] = useState<StudioData | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    api<StudioData>("studio")
      .then((s) => {
        if (live) setStats(s);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [data]);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setLoading(true);
    setDetail(null);
    setError("");
    api<Detail>("studio?source=" + encodeURIComponent(selected))
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [selected, data]);
  function choose(id: string) {
    setSelected(id);
    setTab("overview");
    if (window.innerWidth < 1000)
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({ block: "start" }),
      );
  }
  const filtered = data.sources
    .filter(
      (s) =>
        (type === "all" ||
          (type === "url" ? !!s.original_url : !s.original_url)) &&
        `${s.title} ${s.markdown} ${s.original_url ?? ""}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) =>
      order === "title"
        ? a.title.localeCompare(b.title, "zh-CN")
        : order === "oldest"
          ? a.fetched_at.localeCompare(b.fetched_at)
          : b.fetched_at.localeCompare(a.fetched_at),
    );
  const s = detail?.source;
  return (
    <div className="studio-sources">
      <PageHeading
        eyebrow="SOURCES & EVIDENCE"
        title="资料采集中心"
        description="把分散的资料留在一处，为 Agent 提供可追溯的原文与快照。"
        actions={
          <button className="button primary" onClick={() => onImport("url")}>
            <Plus size={17} />
            保存来源
          </button>
        }
      />
      <div className="studio-capture-grid">
        {[
          {
            mode: "url" as const,
            title: "保存链接",
            sub: "留存公开网页与原文",
            icon: Link2,
            tone: "green",
          },
          {
            mode: "manual" as const,
            title: "粘贴原文",
            sub: "归档已经取得的资料",
            icon: FileText,
            tone: "violet",
          },
          {
            mode: "file" as const,
            title: "上传文件",
            sub: "HTML / Markdown / TXT / PDF",
            icon: Upload,
            tone: "mint",
          },
        ].map((a) => (
          <button
            className="studio-capture"
            aria-label={a.title}
            aria-description={a.sub}
            key={a.mode}
            onClick={() => onImport(a.mode)}
          >
            <span className={"studio-icon tone-" + a.tone}>
              <a.icon size={23} />
            </span>
            <span>
              <strong>{a.title}</strong>
              <small>{a.sub}</small>
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
        <a
          className="studio-capture"
          href="/docs/agents"
          target="_blank"
          rel="noreferrer"
        >
          <span className="studio-icon tone-blue">
            <Code2 size={23} />
          </span>
          <span>
            <strong>通过 Agent 写入</strong>
            <small>REST 与 MCP 共用数据</small>
          </span>
          <ArrowUpRight size={15} />
        </a>
      </div>
      <div className="studio-metrics compact-metrics">
        <Metric
          label="来源总数"
          value={data.counts.sources}
          note="原始快照已留存"
          icon={BookOpen}
        />
        <Metric
          label="附原始链接"
          value={stats?.counts.url_sources ?? "—"}
          note="链接仅作为来源元信息"
          icon={Link2}
        />
        <Metric
          label="被正文引用"
          value={stats?.counts.linked_sources ?? "—"}
          note="当前正文版本关联"
          icon={ShieldCheck}
        />
        <Metric
          label="近 7 天归档"
          value={stats?.counts.recent_sources ?? "—"}
          note="来自实际归档时间"
          icon={Clock3}
        />
      </div>
      <div className={"studio-explorer " + (selected ? "has-selection" : "")}>
        <section className="studio-panel explorer-list">
          <div className="studio-filter-tabs">
            {[
              ["all", "全部来源"],
              ["url", "附链接"],
              ["local", "本地存档"],
            ].map(([v, label]) => (
              <button
                key={v}
                className={type === v ? "active" : ""}
                aria-pressed={type === v}
                onClick={() => setType(v)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="studio-filter-bar">
            <label className="studio-search">
              <Search size={16} />
              <input
                aria-label="搜索来源"
                placeholder="搜索已载入来源、网址或原文…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button aria-label="清空来源搜索" onClick={() => setQuery("")}>
                  <X size={15} />
                </button>
              )}
            </label>
            <select
              aria-label="来源排序"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
            >
              <option value="newest">最近归档</option>
              <option value="oldest">最早归档</option>
              <option value="title">标题排序</option>
            </select>
          </div>
          {filtered.length ? (
            <div className="studio-table-scroll">
              <table className="studio-table source-table">
                <thead>
                  <tr>
                    <th>信息源</th>
                    <th>来源类型</th>
                    <th>人工可信度</th>
                    <th>归档时间</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s, i) => (
                    <tr
                      key={s.id}
                      className={selected === s.id ? "is-selected" : ""}
                    >
                      <td>
                        <button
                          className="studio-identity"
                          aria-pressed={selected === s.id}
                          onClick={() => choose(s.id)}
                        >
                          <span
                            className={
                              "studio-icon tone-" +
                              ["green", "blue", "violet", "amber"][i % 4]
                            }
                          >
                            {s.original_url ? (
                              <Link2 size={19} />
                            ) : (
                              <FileText size={19} />
                            )}
                          </span>
                          <span>
                            <strong>{s.title}</strong>
                            <small>{domainOf(s.original_url)}</small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className="studio-pill neutral">
                          {s.original_url ? "附链接" : "手工 / 文件"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={
                            "studio-pill " +
                            (s.trust_level === "high" ? "success" : "neutral")
                          }
                        >
                          {s.trust_level === "high"
                            ? "标记为高"
                            : s.trust_level === "low"
                              ? "待证实"
                              : "未核实"}
                        </span>
                      </td>
                      <td>
                        <small>{formatDate(s.fetched_at)}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={
                query || type !== "all"
                  ? "没有匹配的来源"
                  : "让资料不再散落各处"
              }
              description={
                query
                  ? "试试标题中的关键词，或清空筛选。"
                  : "保存公开网页、粘贴原文，或上传原始文件。"
              }
              action={
                <button
                  className="button secondary"
                  onClick={() =>
                    query || type !== "all"
                      ? (setQuery(""), setType("all"))
                      : onImport("url")
                  }
                >
                  {query || type !== "all" ? "清空筛选" : "保存第一个来源"}
                </button>
              }
            />
          )}
          <div className="studio-list-footer">
            <span>
              显示 {filtered.length} / 已载入 {data.sources.length} 条 · 全库{" "}
              {data.counts.sources} 条
            </span>
            {data.sources.length < data.counts.sources && (
              <button className="text-button" disabled={busy} onClick={onMore}>
                加载更多
                <ArrowRight size={15} />
              </button>
            )}
          </div>
        </section>
        <aside
          className="studio-panel explorer-detail"
          ref={detailRef}
          aria-label="来源详情"
        >
          {!selected ? (
            <div className="studio-detail-placeholder">
              <span className="studio-icon tone-green">
                <BookOpen size={29} />
              </span>
              <h2>每份资料，都有来处。</h2>
              <p>选择一条来源，查看原文、原始快照和关联的内容。</p>
              <div className="studio-placeholder-lines">
                <i />
                <i />
                <i />
              </div>
              <span className="studio-pill neutral">
                <LockIcon />
                默认私有 · 按授权访问
              </span>
            </div>
          ) : (
            <>
              <div className="studio-detail-top">
                <span className="studio-icon tone-green">
                  <BookOpen size={23} />
                </span>
                <div>
                  <h2>{s?.title ?? "来源详情"}</h2>
                  <small>{s ? domainOf(s.original_url) : "读取原始记录"}</small>
                </div>
                <button
                  className="icon-button"
                  aria-label="关闭来源详情"
                  onClick={() => {
                    setSelected("");
                    setDetail(null);
                  }}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="studio-filter-tabs" aria-label="来源详情视图">
                {[
                  ["overview", "概览"],
                  ["text", "原文"],
                  ["related", "关联内容"],
                ].map(([v, l]) => (
                  <button
                    aria-pressed={tab === v}
                    className={tab === v ? "active" : ""}
                    key={v}
                    onClick={() => setTab(v as typeof tab)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {loading ? (
                <div className="studio-quiet">
                  <Spinner />
                  正在读取来源…
                </div>
              ) : error ? (
                <div className="studio-quiet" role="alert">
                  <p>{error}</p>
                  <button
                    className="button secondary"
                    onClick={() => onFullSource(selected)}
                  >
                    重新打开来源
                  </button>
                </div>
              ) : (
                s && (
                  <div className="studio-detail-body">
                    {tab === "overview" && (
                      <>
                        <h3>原始链接</h3>
                        {s.original_url ? (
                          <div className="studio-link-box">
                            <External url={s.original_url}>
                              {s.original_url}
                            </External>
                          </div>
                        ) : (
                          <p className="muted">
                            手工或文件归档，没有外部链接。
                          </p>
                        )}
                        <h3>原文节选</h3>
                        <p className="studio-excerpt">
                          {s.markdown.slice(0, 400)}
                          {s.markdown.length > 400 ? "…" : ""}
                        </p>
                        <div className="studio-note">
                          <ShieldCheck size={17} />
                          <span>
                            来源可信度由人工判断。归档成功不代表内容已经核实。
                          </span>
                        </div>
                        <h3>快照信息</h3>
                        <dl className="studio-dl">
                          <div>
                            <dt>归档时间</dt>
                            <dd>{formatDate(s.fetched_at)}</dd>
                          </div>
                          <div>
                            <dt>当前关联</dt>
                            <dd>
                              {detail.related.length}
                              {detail.has_more ? "+" : ""} 篇内容
                            </dd>
                          </div>
                          <div>
                            <dt>保留方式</dt>
                            <dd>原始字节 · 不可变</dd>
                          </div>
                        </dl>
                        <details className="studio-technical">
                          <summary>查看完整性摘要</summary>
                          <code>{s.sha256}</code>
                        </details>
                      </>
                    )}
                    {tab === "text" && (
                      <>
                        <div className="studio-note">
                          原文为参考资料，不作为执行指令。
                        </div>
                        <pre className="studio-source-text">
                          {s.markdown.slice(0, 12000)}
                        </pre>
                        {s.markdown.length > 12000 && (
                          <button
                            className="button secondary"
                            onClick={() => onFullSource(s.id)}
                          >
                            打开完整原文
                          </button>
                        )}
                      </>
                    )}
                    {tab === "related" &&
                      (detail.related.length ? (
                        <div className="studio-related-list">
                          {detail.related.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => onOpenContent(c.id)}
                            >
                              <FileText size={18} />
                              <span>
                                <strong>{c.title}</strong>
                                <small>当前版本 v{c.current_version}</small>
                              </span>
                              <Badge value={c.status} />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="studio-quiet">
                          <FileText size={23} />
                          <p>当前还没有正文引用这份资料。</p>
                        </div>
                      ))}
                    <div className="studio-detail-actions">
                      <button
                        className="button secondary"
                        onClick={() =>
                          void downloadFile(
                            "sources/" + s.id + "/snapshot",
                          ).catch((e) => notice(e.message, true))
                        }
                      >
                        <Download size={16} />
                        下载快照
                      </button>
                      <button
                        className="button primary"
                        onClick={() => onCreate(s)}
                      >
                        <Plus size={16} />
                        基于此来源创建
                      </button>
                    </div>
                  </div>
                )
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
function LockIcon() {
  return <ShieldCheck size={13} />;
}
