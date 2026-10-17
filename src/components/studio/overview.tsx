"use client";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bot,
  Database,
  FileCode2,
  FileText,
  Folder,
  Link2,
  Plus,
  ShieldCheck,
  Sparkles,
  Package,
  KeyRound,
} from "lucide-react";
import type { HubData } from "@/lib/domain";
import { Badge, Empty, type Notice } from "../ui";
import {
  Metric,
  PageHeading,
  PanelHeading,
  RequestTable,
  scopeLabels,
  useAdminSnapshot,
  safeDate,
} from "./shared";

type View =
  | "overview"
  | "agents"
  | "contents"
  | "sources"
  | "assets"
  | "artifacts"
  | "publications"
  | "settings";
export function StudioOverview({
  data,
  navigate,
  onOpen,
  onCreate,
  onSource,
  onDemo,
  busy,
}: {
  data: HubData;
  navigate: (view: View) => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onSource: () => void;
  onDemo: () => void;
  busy: boolean;
  notice: Notice;
}) {
  const snapshot = useAdminSnapshot(data);
  const admin = snapshot.data;
  const active = admin?.agents.filter((a) => a.active).length;
  const recent = admin?.requests ?? [];
  const selected = admin?.agents.find((a) => a.active) ?? admin?.agents[0];
  const total =
    data.counts.sources + data.counts.contents + data.counts.artifacts;
  const distribution = [
    { label: "信息来源", value: data.counts.sources, className: "sources" },
    { label: "内容正文", value: data.counts.contents, className: "contents" },
    { label: "冻结产物", value: data.counts.artifacts, className: "artifacts" },
  ];
  const angle1 = total ? (data.counts.sources / total) * 100 : 0;
  const angle2 = total
    ? ((data.counts.sources + data.counts.contents) / total) * 100
    : 0;
  return (
    <div className="studio-overview">
      <PageHeading
        eyebrow="YOUR PRIVATE KNOWLEDGE WORKSPACE"
        title="让 Agent 协作，让数据有据。"
        description="统一管理你的 AI Agent、信息来源与内容资产。每一次写入，都有迹可循。"
        actions={
          <>
            <button className="button secondary" onClick={onSource}>
              <Link2 size={16} />
              保存来源
            </button>
            <button
              className="button primary"
              onClick={() => navigate("agents")}
            >
              <Plus size={17} />
              管理 Agent
            </button>
          </>
        }
      />
      <div className="studio-metrics">
        <Metric
          icon={Bot}
          label="已授权 Agent"
          value={active ?? "—"}
          note={
            admin
              ? `${admin.agents.length} 个身份 · 独立访问权限`
              : "正在读取授权信息"
          }
          onClick={() => navigate("agents")}
        />
        <Metric
          icon={Folder}
          label="项目空间"
          value={admin?.projects.length ?? "—"}
          note="项目与操作双重边界"
          onClick={() => navigate("agents")}
          tone="teal"
        />
        <Metric
          icon={Database}
          label="内容资产"
          value={data.counts.contents.toLocaleString()}
          note="版本化正文 · 原始记录"
          onClick={() => navigate("contents")}
          tone="sage"
        />
        <Metric
          icon={Activity}
          label="最近调用记录"
          value={admin ? recent.length : "—"}
          note="最近最多 30 条 · 非总请求数"
          onClick={() => navigate("agents")}
          tone="blue"
        />
      </div>
      {snapshot.error && (
        <div className="inline-error" role="alert">
          Agent 数据读取失败：{snapshot.error}
          <button className="text-button" onClick={snapshot.retry}>
            重试
          </button>
        </div>
      )}
      <div className="studio-overview-main">
        <section className="studio-panel">
          <PanelHeading
            title="Agent 管理"
            count={admin?.agents.length}
            action={
              <button
                className="text-button"
                onClick={() => navigate("agents")}
              >
                管理全部 <ArrowRight size={15} />
              </button>
            }
          />
          {admin?.agents.length ? (
            <div className="studio-table-scroll">
              <table className="studio-table overview-agents">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>权限 / 能力</th>
                    <th>项目范围</th>
                    <th>授权状态</th>
                  </tr>
                </thead>
                <tbody>
                  {admin.agents.slice(0, 4).map((agent, i) => (
                    <tr key={agent.id}>
                      <td>
                        <button
                          className="studio-identity"
                          onClick={() => navigate("agents")}
                        >
                          <span
                            className={`studio-icon small tone-${["green", "blue", "amber", "violet"][i % 4]}`}
                          >
                            <Bot size={19} />
                          </span>
                          <span>
                            <strong>{agent.name}</strong>
                            <small className="mono">
                              {agent.id.slice(0, 13)}…
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <div className="studio-chip-wrap">
                          {agent.scopes.slice(0, 2).map((s) => (
                            <span className="studio-chip" key={s}>
                              {scopeLabels[s] ?? s}
                            </span>
                          ))}
                          {agent.scopes.length > 2 && (
                            <span className="studio-chip neutral">
                              +{agent.scopes.length - 2}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="studio-chip-wrap">
                          {agent.project_ids.slice(0, 2).map((id) => (
                            <span className="studio-chip blue" key={id}>
                              {admin.projects.find((p) => p.id === id)?.name ??
                                id}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`studio-status ${agent.active ? "enabled" : "disabled"}`}
                        >
                          <i />
                          {agent.active ? "已授权" : "已停用"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="连接第一个 Agent"
              description="为调研、写作或产物助手分配独立身份，让数据在工具之间流动。"
              action={
                <button
                  className="button secondary"
                  onClick={() => navigate("agents")}
                >
                  <Plus size={16} />
                  连接新 Agent
                </button>
              }
            />
          )}
          <div className="studio-panel-foot">
            <ShieldCheck size={14} />
            仅显示访问授权，不代表 Agent 正在运行。
          </div>
        </section>
        <section className="studio-panel capability-panel">
          <PanelHeading
            title={selected ? "授权能力预览" : "从最小权限开始"}
            action={<KeyRound size={17} />}
          />
          {selected && (
            <p className="panel-subtitle">
              {selected.name} · {selected.active ? "已授权" : "已停用"}
            </p>
          )}
          <div className="capability-list">
            {(selected
              ? selected.scopes.slice(0, 5)
              : [
                  "sources:read",
                  "contents:read",
                  "contents:write",
                  "changes:read",
                ]
            ).map((scope, i) => (
              <div className="capability-item" key={scope}>
                <span className="studio-icon small tone-green">
                  {i === 0 ? (
                    <BookOpen size={19} />
                  ) : i === 1 ? (
                    <FileText size={19} />
                  ) : i === 2 ? (
                    <FileCode2 size={19} />
                  ) : (
                    <Activity size={19} />
                  )}
                </span>
                <div>
                  <strong>{scopeLabels[scope] ?? scope}</strong>
                  <small className="mono">{scope}</small>
                </div>
                <span className="studio-chip">
                  {selected
                    ? selected.active
                      ? "已授权"
                      : "已停用"
                    : "可配置"}
                </span>
              </div>
            ))}
          </div>
          <a
            className="studio-inline-link"
            href="/docs/agents"
            target="_blank"
            rel="noreferrer"
          >
            查看 API 与 MCP 接入指南 <ArrowUpRight size={15} />
          </a>
        </section>
      </div>
      <div className="studio-overview-bottom">
        <section className="studio-panel">
          <PanelHeading
            title="最近内容"
            count={data.counts.contents}
            action={
              <button className="text-button" onClick={onCreate}>
                <Plus size={15} />
                新建内容
              </button>
            }
          />
          {data.contents.length ? (
            <div className="studio-recent-contents">
              {data.contents.slice(0, 3).map((c) => (
                <button
                  key={c.id}
                  className="content-card studio-content-row"
                  onClick={() => onOpen(c.id)}
                >
                  <span className="studio-icon small tone-green">
                    <FileText size={19} />
                  </span>
                  <div>
                    <h3>{c.title}</h3>
                    <p>
                      {c.excerpt?.replace(c.title, "").trim() ||
                        "这篇内容还在酝酿中。"}
                    </p>
                    <small>
                      {safeDate(c.updated_at)} · v{c.current_version}
                    </small>
                  </div>
                  <Badge value={c.status} />
                </button>
              ))}
            </div>
          ) : (
            <Empty
              title="你的知识资产，从这里生长"
              description="保存第一份资料，或导入明确标记的示例，体验完整工作流。"
              action={
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={onDemo}
                >
                  <Sparkles size={16} />
                  导入示例
                </button>
              }
            />
          )}
        </section>
        <section className="studio-panel">
          <PanelHeading
            title="最近调用"
            action={
              <button
                className="text-button"
                onClick={() => navigate("agents")}
              >
                全部 <ArrowRight size={14} />
              </button>
            }
          />
          <RequestTable
            requests={recent}
            agents={admin?.agents ?? []}
            limit={4}
          />
        </section>
        <section className="studio-panel distribution-panel">
          <PanelHeading title="数据资产构成" />
          <div
            className="studio-donut"
            role="img"
            aria-label={`信息来源 ${data.counts.sources}，内容正文 ${data.counts.contents}，冻结产物 ${data.counts.artifacts}`}
            style={{
              background: total
                ? `conic-gradient(#337a59 0 ${angle1}%, #69bba2 ${angle1}% ${angle2}%, #a7b6e5 ${angle2}% 100%)`
                : "#e9eee9",
            }}
          >
            <div>
              <strong>{total.toLocaleString()}</strong>
              <span>资源记录</span>
            </div>
          </div>
          <div className="studio-legend">
            {distribution.map((item) => (
              <div key={item.label}>
                <span>
                  <i className={item.className} />
                  {item.label}
                </span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <div className="studio-panel-foot">
            资源类型构成，不代表采集渠道占比。
          </div>
        </section>
      </div>
    </div>
  );
}
