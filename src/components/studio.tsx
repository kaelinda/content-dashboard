"use client";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bot,
  Database,
  FileText,
  Folder,
  Image as ImageIcon,
  Layers3,
  Link2,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { api, Badge, Empty, formatDate, Spinner, type Notice } from "./ui";
import type { HubData } from "@/lib/domain";

export type StudioData = {
  counts: {
    agents: number;
    authorized: number;
    projects: number;
    contents: number;
    sources: number;
    assets: number;
    artifacts: number;
    publications: number;
    requests: number;
    errors_7d: number;
    url_sources: number;
    linked_sources: number;
    recent_sources: number;
  };
  projects: {
    id: string;
    name: string;
    contents: number;
    sources: number;
    agents: number;
  }[];
  days: { day: string; requests: number; errors: number }[];
  observed_at: string;
  timezone: string;
  coverage: string;
};
export type AgentRow = {
  id: string;
  name: string;
  active: boolean;
  scopes: string[];
  project_ids: string[];
  created_at?: string;
};
export type RequestRow = {
  request_id: string;
  principal_id: string;
  operation: string;
  status: number;
  code: string | null;
  duration_ms: number;
  created_at: string;
};
export type AdminData = {
  agents: AgentRow[];
  projects: { id: string; name: string }[];
  scopes: string[];
  requests: RequestRow[];
};
export const scopeNames: Record<string, string> = {
  "sources:read": "读取来源",
  "sources:write": "保存来源",
  "contents:read": "读取正文",
  "contents:write": "创建与修改正文",
  "files:read": "读取文件",
  "files:write": "上传文件",
  "artifacts:read": "读取分发文件",
  "artifacts:write": "登记分发文件",
  "changes:read": "读取变化记录",
};
export const domainOf = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "本地存档";
  } catch {
    return "原始链接";
  }
};
export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="studio-heading">
      <div>
        <span className="studio-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="studio-heading-actions">{actions}</div>}
    </header>
  );
}
export function Metric({
  label,
  value,
  note,
  icon: Icon,
  tone = "green",
  onClick,
}: {
  label: string;
  value: number | string;
  note: string;
  icon: LucideIcon;
  tone?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className={"studio-icon tone-" + tone}>
        <Icon size={23} strokeWidth={1.65} />
      </span>
      <div className="metric-copy">
        <span>{label}</span>
        <strong>
          {typeof value === "number" ? value.toLocaleString() : value}
        </strong>
        <small>{note}</small>
      </div>
      {onClick && <ArrowUpRight className="metric-arrow" size={15} />}
    </>
  );
  return onClick ? (
    <button className="studio-metric" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="studio-metric">{inner}</div>
  );
}
export function PanelTitle({
  title,
  aside,
}: {
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="studio-panel-title">
      <h2>{title}</h2>
      {aside}
    </div>
  );
}
export function RequestTable({
  requests,
  agents,
  compact = false,
  onInspect,
}: {
  requests: RequestRow[];
  agents: AgentRow[];
  compact?: boolean;
  onInspect?: (r: RequestRow) => void;
}) {
  return requests.length ? (
    <div className="studio-table-scroll">
      <table className="studio-table agent-table">
        <thead>
          <tr>
            <th>操作 / 时间</th>
            {!compact && <th>Agent</th>}
            <th>结果</th>
            <th>耗时</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.request_id}>
              <td>
                {onInspect ? (
                  <button
                    className="studio-table-link mono"
                    onClick={() => onInspect(r)}
                  >
                    {r.operation}
                    <ArrowUpRight size={12} />
                  </button>
                ) : (
                  <strong className="mono">{r.operation}</strong>
                )}
                <small>{formatDate(r.created_at)}</small>
              </td>
              {!compact && (
                <td>
                  {agents.find((a) => a.id === r.principal_id)?.name ??
                    r.principal_id}
                </td>
              )}
              <td>
                <span
                  className={
                    "studio-pill " + (r.status < 400 ? "success" : "warning")
                  }
                >
                  {r.status < 400 ? "成功" : r.status + " · 失败"}
                </span>
              </td>
              <td className="mono">{r.duration_ms} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="studio-quiet">
      <Activity size={25} />
      <strong>等待第一次调用</strong>
      <p>连接 Agent 后，这里会记录实际请求的结果。</p>
    </div>
  );
}
export function StudioOverview({
  data,
  navigate,
  openContent,
  openSource,
  onImport,
  onDemo,
  busy,
  notice,
}: {
  data: HubData;
  navigate: (view: any) => void;
  openContent: (id: string) => void;
  openSource: (id: string) => void;
  onImport: () => void;
  onDemo: () => void;
  busy: boolean;
  notice: Notice;
}) {
  const [stats, setStats] = useState<StudioData | null>(null),
    [admin, setAdmin] = useState<AdminData | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([
      api<StudioData>("studio"),
      api<{ data: AdminData }>("v1/admin"),
    ])
      .then(([s, a]) => {
        if (active) {
          setStats(s);
          setAdmin(a.data);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [data]);
  const composition = [
    {
      name: "信息源",
      value: stats?.counts.sources ?? data.counts.sources,
      tone: "green",
    },
    {
      name: "内容条目",
      value: stats?.counts.contents ?? data.counts.contents,
      tone: "mint",
    },
    {
      name: "冻结产物",
      value: stats?.counts.artifacts ?? data.counts.artifacts,
      tone: "violet",
    },
    {
      name: "图片素材",
      value: stats?.counts.assets ?? data.assets.length,
      tone: "gray",
    },
  ];
  const total = composition.reduce((n, c) => n + c.value, 0);
  let angle = 0;
  const sectors = composition.map((c, i) => {
    const start = angle;
    angle += total ? (c.value / total) * 360 : 0;
    return `var(--chart-${i}) ${start}deg ${angle}deg`;
  });
  return (
    <div className="studio-overview">
      <PageHeading
        eyebrow="YOUR PRIVATE DATA WORKSPACE"
        title="让 Agent 协作，让数据有据。"
        description="连接你的 AI Agent，让资料、内容与每一份输出都有来处。"
        actions={
          <>
            <button className="button secondary" onClick={onImport}>
              <Link2 size={16} />
              保存来源
            </button>
            <button
              className="button primary"
              onClick={() => navigate("agents")}
            >
              <Plus size={17} />
              连接新 Agent
            </button>
          </>
        }
      />
      {error && (
        <div className="inline-note" role="alert">
          概览暂时无法更新：{error}
          <button
            className="text-button"
            onClick={() => window.location.reload()}
          >
            重试
          </button>
        </div>
      )}
      <div className="studio-metrics">
        <Metric
          label="Agent 身份"
          value={stats?.counts.agents ?? "—"}
          note={stats ? `${stats.counts.authorized} 个已授权` : "正在读取"}
          icon={Bot}
          onClick={() => navigate("agents")}
        />
        <Metric
          label="项目空间"
          value={stats?.counts.projects ?? "—"}
          note="独立的数据访问边界"
          icon={Folder}
          onClick={() => navigate("agents")}
        />
        <Metric
          label="内容资产"
          value={data.counts.contents}
          note="有版本，可追溯"
          icon={Database}
          onClick={() => navigate("contents")}
        />
        <Metric
          label="已记录调用"
          value={stats?.counts.requests ?? "—"}
          note="Agent JSON / MCP 累计"
          icon={Activity}
          onClick={() => navigate("agents")}
        />
      </div>
      <div className="studio-dashboard-grid">
        <section className="studio-panel dashboard-agents">
          <PanelTitle
            title="Agent 管理"
            aside={
              <button
                className="text-button"
                onClick={() => navigate("agents")}
              >
                管理连接
                <ArrowRight size={15} />
              </button>
            }
          />
          {!admin ? (
            <div className="studio-quiet">
              {error ? "连接数据不可用" : <Spinner />}
            </div>
          ) : admin.agents.length ? (
            <div className="studio-table-scroll">
              <table className="studio-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>权限与项目</th>
                    <th>最近调用</th>
                    <th>授权状态</th>
                  </tr>
                </thead>
                <tbody>
                  {admin.agents.slice(0, 4).map((a, i) => {
                    const last = admin.requests.find(
                      (r) => r.principal_id === a.id,
                    );
                    return (
                      <tr key={a.id}>
                        <td>
                          <button
                            className="studio-identity"
                            onClick={() => navigate("agents")}
                          >
                            <span
                              className={
                                "studio-icon tone-" +
                                ["green", "blue", "amber", "violet"][i % 4]
                              }
                            >
                              <Bot size={20} />
                            </span>
                            <span>
                              <strong>{a.name}</strong>
                              <small className="mono">
                                {a.id.slice(0, 8)}…
                              </small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <div className="studio-chips">
                            <span>
                              {a.scopes.some((s) => s.endsWith(":write"))
                                ? "可读写"
                                : "只读"}
                            </span>
                            <span>{a.project_ids.length} 个项目</span>
                          </div>
                        </td>
                        <td>
                          <small>
                            {last
                              ? formatDate(last.created_at)
                              : "尚无调用记录"}
                          </small>
                          {last && (
                            <span className="mono studio-sub">
                              {last.operation}
                            </span>
                          )}
                        </td>
                        <td>
                          <span
                            className={
                              "studio-pill " +
                              (a.active ? "success" : "neutral")
                            }
                          >
                            {a.active ? "已授权" : "已停用"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="从第一个 Agent 开始"
              description="为每个执行器分配独立身份，决定它可以读取和写入的范围。"
              action={
                <button
                  className="button secondary"
                  onClick={() => navigate("agents")}
                >
                  <Plus size={16} />
                  创建 Agent 身份
                </button>
              }
            />
          )}
        </section>
        <section className="studio-panel dashboard-capabilities">
          <PanelTitle title="数据能力" aside={<ShieldCheck size={17} />} />
          {[
            {
              title: "归档来源",
              desc: "保留原文，而不只是一个链接",
              icon: BookOpen,
              view: "sources",
            },
            {
              title: "版本化正文",
              desc: "安全修改，保留每一份历史",
              icon: FileText,
              view: "contents",
            },
            {
              title: "冻结输出",
              desc: "保存真正生成的文件与配方",
              icon: Layers3,
              view: "artifacts",
            },
            {
              title: "项目与权限",
              desc: "数据只对你授权的 Agent 可见",
              icon: ShieldCheck,
              view: "agents",
            },
          ].map((x) => (
            <button
              className="studio-capability"
              key={x.title}
              onClick={() => navigate(x.view)}
            >
              <span className="studio-icon tone-green">
                <x.icon size={20} />
              </span>
              <span>
                <strong>{x.title}</strong>
                <small>{x.desc}</small>
              </span>
              <ArrowUpRight size={14} />
            </button>
          ))}
        </section>
        <section className="studio-panel dashboard-content">
          <PanelTitle
            title="最近内容"
            aside={
              <button
                className="text-button"
                onClick={() => navigate("contents")}
              >
                查看全部
                <ArrowRight size={15} />
              </button>
            }
          />
          {data.contents.length ? (
            <div className="studio-recent-content">
              {data.contents.slice(0, 3).map((c) => (
                <button
                  key={c.id}
                  className="content-card studio-story"
                  onClick={() => openContent(c.id)}
                >
                  <div>
                    <span className="studio-icon tone-green">
                      <FileText size={19} />
                    </span>
                    <Badge value={c.status} />
                  </div>
                  <h3>{c.title}</h3>
                  <p>
                    {c.excerpt?.replace(c.title, "").trim() ||
                      "打开并继续完善这份内容。"}
                  </p>
                  <footer>
                    <span>
                      v{c.current_version} · {c.source_count ?? 0} 个来源
                    </span>
                    <ArrowUpRight size={14} />
                  </footer>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              title="收集之后，开始沉淀"
              description="让 Agent 写入第一份内容，或用明确标记的示例了解工作流。"
              action={
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={onDemo}
                >
                  {busy ? <Spinner /> : <Sparkles size={16} />}导入示例
                </button>
              }
            />
          )}
        </section>
        <section className="studio-panel dashboard-requests">
          <PanelTitle
            title="最近调用"
            aside={<span className="studio-sub">实际记录</span>}
          />
          <RequestTable
            requests={admin?.requests.slice(0, 4) ?? []}
            agents={admin?.agents ?? []}
            compact
          />
          <p className="studio-panel-footnote">
            仅展示已记录的业务调用，不代表全部 API 流量。
          </p>
        </section>
        <section className="studio-panel dashboard-distribution">
          <PanelTitle
            title="资产构成"
            aside={<span className="studio-sub">全库记录</span>}
          />
          <div className="studio-composition">
            <div
              role="img"
              aria-label={composition
                .map((c) => `${c.name} ${c.value} 条`)
                .join("，")}
              className="studio-donut"
              style={{
                background: total
                  ? `conic-gradient(${sectors.join(",")})`
                  : "var(--line)",
              }}
            >
              <div>
                <strong>{total.toLocaleString()}</strong>
                <small>条记录</small>
              </div>
            </div>
            <div className="studio-legend">
              {composition.map((c, i) => (
                <div key={c.name}>
                  <i style={{ background: `var(--chart-${i})` }} />
                  <span>{c.name}</span>
                  <strong>{c.value}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="studio-panel dashboard-sources">
          <PanelTitle
            title="最近归档"
            aside={
              <button
                className="text-button"
                onClick={() => navigate("sources")}
              >
                资料库
                <ArrowRight size={15} />
              </button>
            }
          />
          {data.sources.length ? (
            data.sources.slice(0, 3).map((s) => (
              <button
                className="studio-source-mini"
                key={s.id}
                onClick={() => openSource(s.id)}
              >
                <span className="studio-icon tone-mint">
                  <BookOpen size={18} />
                </span>
                <span>
                  <strong>{s.title}</strong>
                  <small>
                    {domainOf(s.original_url)} · {formatDate(s.fetched_at)}
                  </small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            ))
          ) : (
            <div className="studio-quiet">
              <BookOpen size={24} />
              <p>保存来源后，可跨文章复用资料。</p>
              <button className="text-button" onClick={onImport}>
                保存第一个来源
                <ArrowRight size={14} />
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
