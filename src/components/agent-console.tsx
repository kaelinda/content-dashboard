"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Bot,
  KeyRound,
  ShieldCheck,
  Plus,
  Copy,
  RefreshCw,
  FileCode2,
  ArrowUpRight,
  Search,
  X,
  Folder,
  FileText,
  LockKeyhole,
  ArrowRight,
  Check,
  Activity,
} from "lucide-react";
import { Modal, Spinner, type Notice, formatDate, api, Empty } from "./ui";
import {
  PageHeading,
  PanelTitle,
  Metric,
  RequestTable,
  type StudioData,
  type RequestRow,
} from "./studio";
type Agent = {
  id: string;
  name: string;
  scopes: string[];
  project_ids: string[];
  active: boolean;
};
type Project = { id: string; name: string };
type Admin = {
  agents: Agent[];
  projects: Project[];
  scopes: string[];
  requests: {
    request_id: string;
    principal_id: string;
    operation: string;
    status: number;
    code: string | null;
    duration_ms: number;
    created_at: string;
  }[];
};
const scopeLabels: Record<string, string> = {
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
const presets: Record<string, string[]> = {
  只读审阅: ["sources:read", "contents:read", "artifacts:read", "changes:read"],
  调研助手: ["sources:read", "sources:write", "contents:read", "changes:read"],
  写作助手: ["sources:read", "contents:read", "contents:write", "changes:read"],
  产物助手: [
    "contents:read",
    "files:read",
    "files:write",
    "artifacts:read",
    "artifacts:write",
    "changes:read",
  ],
};
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api/v1/" + path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.detail ?? "操作失败");
  return result.data;
}
export function AgentConsole({
  notice,
  onSettings,
}: {
  notice: Notice;
  onSettings?: () => void;
}) {
  const [projectFilter, setProjectFilter] = useState("all"),
    [selectedId, setSelectedId] = useState(""),
    [query, setQuery] = useState(""),
    [statusFilter, setStatusFilter] = useState("all"),
    [detailTab, setDetailTab] = useState("permissions");
  const [stats, setStats] = useState<StudioData | null>(null),
    [inspectedRequest, setInspectedRequest] = useState<RequestRow | null>(null);
  const [data, setData] = useState<Admin | null>(null),
    [error, setError] = useState("");
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [scopes, setScopes] = useState(presets["只读审阅"]),
    [projects, setProjects] = useState(["default"]),
    [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState(""),
    [confirm, setConfirm] = useState<Agent | null>(null),
    [projectOpen, setProjectOpen] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setData(await request<Admin>("admin"));
      try {
        setStats(await api<StudioData>("studio"));
      } catch {
        setStats(null);
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await request<Agent>("agents", "POST", {
        name,
        scopes,
        project_ids: projects,
      });
      setSelectedId(created.id);
      setProjectFilter("all");
      setQuery("");
      setStatusFilter("all");
      setOpen(false);
      setName("");
      await refresh();
      notice("Agent 身份已创建。请为该身份生成独立令牌。");
    } catch (e) {
      notice((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function issue(agent: Agent) {
    setBusy(true);
    try {
      const r = await request<{ token: string }>(
        `agents/${agent.id}/tokens`,
        "POST",
        {},
      );
      setSecret(r.token);
      notice("新令牌仅显示一次。已有令牌仍有效，可在连接设置中单独撤销。");
    } catch (e) {
      notice((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function toggle() {
    if (!confirm) return;
    setBusy(true);
    try {
      await request(`agents/${confirm.id}`, "PATCH", {
        active: !confirm.active,
      });
      setConfirm(null);
      await refresh();
      notice("Agent 授权状态已更新。");
    } catch (e) {
      notice((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const selected = data?.agents.find((a) => a.id === selectedId);
  const currentProject = data?.projects.find((p) => p.id === projectFilter);
  const projectStats = stats?.projects.find((p) => p.id === projectFilter);
  const visibleAgents =
    data?.agents.filter(
      (a) =>
        (projectFilter === "all" || a.project_ids.includes(projectFilter)) &&
        (statusFilter === "all" ||
          (statusFilter === "active" ? a.active : !a.active)) &&
        a.name.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const connect = () => {
    setProjects(projectFilter === "all" ? ["default"] : [projectFilter]);
    setOpen(true);
  };
  const inspect = (id: string) => {
    setSelectedId(id);
    setDetailTab("permissions");
    if (window.innerWidth < 1000)
      requestAnimationFrame(() =>
        document
          .getElementById("agent-permission-detail")
          ?.scrollIntoView({ block: "start" }),
      );
  };
  return (
    <div className="agent-console studio-agent-console">
      <PageHeading
        eyebrow="PROJECTS & ACCESS"
        title="项目与权限管理"
        description="让 Agent 协作，让数据有据。为每个执行器设定清晰、独立的访问边界。"
        actions={
          <>
            <button
              className="button secondary"
              onClick={() => setProjectOpen(true)}
            >
              <Folder size={16} />
              新建项目
            </button>
            <button
              className="button primary"
              onClick={connect}
              disabled={!data}
            >
              <Plus size={17} />
              连接新 Agent
            </button>
          </>
        }
      />
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <button className="text-button" onClick={() => void refresh()}>
            重新加载
          </button>
        </div>
      )}
      {!data && !error && (
        <div className="studio-panel studio-quiet">
          <Spinner />
          正在读取项目与授权…
        </div>
      )}
      {data && (
        <div className="studio-access-layout">
          <aside className="studio-panel studio-projects">
            <PanelTitle
              title="项目空间"
              aside={
                <span className="studio-pill neutral">
                  {data.projects.length}
                </span>
              }
            />
            <div className="studio-project-options">
              <button
                className={projectFilter === "all" ? "active" : ""}
                aria-pressed={projectFilter === "all"}
                onClick={() => {
                  setProjectFilter("all");
                  setSelectedId("");
                }}
              >
                <span className="studio-icon tone-green">
                  <LayersIcon />
                </span>
                <span>
                  <strong>全部项目</strong>
                  <small>{data.agents.length} 个 Agent 身份</small>
                </span>
              </button>
              {data.projects.map((p, i) => {
                const count = stats?.projects.find((s) => s.id === p.id);
                return (
                  <button
                    key={p.id}
                    aria-pressed={projectFilter === p.id}
                    className={projectFilter === p.id ? "active" : ""}
                    onClick={() => {
                      setProjectFilter(p.id);
                      setSelectedId("");
                    }}
                  >
                    <span
                      className={
                        "studio-icon tone-" +
                        ["green", "violet", "blue", "amber"][i % 4]
                      }
                    >
                      <Folder size={21} />
                    </span>
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {
                          data.agents.filter((a) =>
                            a.project_ids.includes(p.id),
                          ).length
                        }{" "}
                        Agent{count ? ` · ${count.contents} 内容` : ""}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              className="studio-add-project"
              onClick={() => setProjectOpen(true)}
            >
              <Plus size={16} />
              新建项目空间
            </button>
            <div className="studio-project-help">
              <ShieldCheck size={19} />
              <p>新项目不会自动授权给现有 Agent。访问范围由你明确决定。</p>
            </div>
          </aside>
          <div className="studio-access-main">
            <section className="studio-panel studio-project-overview">
              <div className="studio-project-title">
                <span className="studio-icon tone-mint">
                  <Folder size={26} />
                </span>
                <div>
                  <h2>{currentProject?.name ?? "全部项目"}</h2>
                  <p>项目隔离 · 按操作授权 · 历史可追溯</p>
                </div>
                <span className="studio-pill success">
                  <LockKeyhole size={12} />
                  私有
                </span>
              </div>
              <div className="studio-project-numbers">
                <div>
                  <strong>
                    {
                      data.agents.filter(
                        (a) =>
                          projectFilter === "all" ||
                          a.project_ids.includes(projectFilter),
                      ).length
                    }
                  </strong>
                  <small>Agent 身份</small>
                </div>
                <div>
                  <strong>
                    {projectFilter === "all"
                      ? (stats?.counts.contents ?? "—")
                      : (projectStats?.contents ?? "—")}
                  </strong>
                  <small>内容条目</small>
                </div>
                <div>
                  <strong>
                    {projectFilter === "all"
                      ? (stats?.counts.sources ?? "—")
                      : (projectStats?.sources ?? "—")}
                  </strong>
                  <small>信息来源</small>
                </div>
              </div>
            </section>
            <section className="studio-panel studio-agents-list">
              <PanelTitle
                title="Agent 身份"
                aside={
                  <button
                    className="text-button"
                    onClick={() => void refresh()}
                  >
                    <RefreshCw size={14} />
                    刷新
                  </button>
                }
              />
              <div className="studio-filter-bar">
                <label className="studio-search">
                  <Search size={15} />
                  <input
                    aria-label="搜索 Agent"
                    placeholder="搜索 Agent 名称…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      aria-label="清空 Agent 搜索"
                      onClick={() => setQuery("")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </label>
                <select
                  aria-label="Agent 授权筛选"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">全部状态</option>
                  <option value="active">已授权</option>
                  <option value="inactive">已停用</option>
                </select>
              </div>
              {visibleAgents.length ? (
                <div className="studio-table-scroll">
                  <table className="studio-table studio-grants-table">
                    <thead>
                      <tr>
                        <th>Agent 名称</th>
                        <th>授权范围</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleAgents.map((a, i) => (
                        <tr
                          key={a.id}
                          className={
                            "agent-card " +
                            (selectedId === a.id ? "is-selected" : "")
                          }
                        >
                          <td>
                            <button
                              className="studio-identity"
                              aria-pressed={selectedId === a.id}
                              onClick={() => inspect(a.id)}
                            >
                              <span
                                className={
                                  "studio-icon tone-" +
                                  ["green", "blue", "violet", "amber"][i % 4]
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
                            <span
                              className={
                                "studio-pill " +
                                (a.active ? "success" : "neutral")
                              }
                            >
                              {a.active ? "已授权" : "已停用"}
                            </span>
                            <small>
                              {a.scopes.length} 项权限 · {a.project_ids.length}{" "}
                              个项目
                            </small>
                          </td>
                          <td>
                            <button
                              className="button secondary compact"
                              disabled={busy || !a.active}
                              onClick={() => void issue(a)}
                            >
                              <KeyRound size={13} />
                              生成令牌
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title={
                    data.agents.length
                      ? "没有符合筛选的 Agent"
                      : "连接你的第一个 Agent"
                  }
                  description="创建身份，授予项目与操作权限，再把令牌交给你信任的执行器。"
                  action={
                    <button className="button secondary" onClick={connect}>
                      创建 Agent 身份
                    </button>
                  }
                />
              )}
              <p className="studio-panel-footnote">
                授权状态不代表 Agent 在线或正在运行。
              </p>
            </section>
            <section className="studio-panel">
              <PanelTitle
                title="最近调用"
                aside={<span className="studio-sub">最近 30 条</span>}
              />
              <RequestTable
                requests={data.requests
                  .filter((r) => !selectedId || r.principal_id === selectedId)
                  .slice(0, 8)}
                agents={data.agents}
                compact
                onInspect={setInspectedRequest}
              />
              <p className="studio-panel-footnote">
                {selected ? "当前所选 Agent · " : ""}
                只显示已记录的业务调用；不记录正文与令牌。
              </p>
            </section>
          </div>
          <aside
            className="studio-panel studio-access-detail"
            id="agent-permission-detail"
            aria-label="Agent 权限详情"
          >
            <PanelTitle
              title="权限与接入"
              aside={
                selected && (
                  <button
                    className="icon-button"
                    aria-label="关闭 Agent 详情"
                    onClick={() => setSelectedId("")}
                  >
                    <X size={17} />
                  </button>
                )
              }
            />
            {selected ? (
              <>
                <div className="studio-selected-agent">
                  <span className="studio-icon tone-green">
                    <Bot size={24} />
                  </span>
                  <div>
                    <h3>{selected.name}</h3>
                    <span
                      className={
                        "studio-pill " +
                        (selected.active ? "success" : "neutral")
                      }
                    >
                      {selected.active ? "已授权" : "已停用"}
                    </span>
                  </div>
                </div>
                <div className="studio-filter-tabs">
                  <button
                    className={detailTab === "permissions" ? "active" : ""}
                    aria-pressed={detailTab === "permissions"}
                    onClick={() => setDetailTab("permissions")}
                  >
                    权限范围
                  </button>
                  <button
                    className={detailTab === "connect" ? "active" : ""}
                    aria-pressed={detailTab === "connect"}
                    onClick={() => setDetailTab("connect")}
                  >
                    接入信息
                  </button>
                </div>
                <div className="studio-detail-body">
                  {detailTab === "permissions" ? (
                    <>
                      <h3>已授予的操作</h3>
                      <div className="studio-grants">
                        {data.scopes.map((scope) => (
                          <div key={scope}>
                            <span>
                              <ShieldCheck size={15} />
                              {scopeLabels[scope] ?? scope}
                            </span>
                            <span
                              className={
                                "scope-granted " +
                                (selected.scopes.includes(scope) ? "yes" : "no")
                              }
                            >
                              {selected.scopes.includes(scope) ? (
                                <Check size={14} />
                              ) : (
                                "—"
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                      <h3>项目访问范围</h3>
                      <div className="studio-project-pills">
                        {selected.project_ids.map((id) => (
                          <span className="studio-pill neutral" key={id}>
                            <Folder size={13} />
                            {data.projects.find((p) => p.id === id)?.name ?? id}
                          </span>
                        ))}
                      </div>
                      <p className="studio-sub">
                        这里展示服务器上的实际授权，不是可编辑的模拟开关。更换范围可创建新身份并停用旧身份。
                      </p>
                    </>
                  ) : (
                    <>
                      <h3>Agent 标识</h3>
                      <div className="studio-copy-id">
                        <code>{selected.id}</code>
                        <button
                          className="icon-button"
                          aria-label="复制 Agent ID"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(selected.id)
                              .then(() => notice("Agent ID 已复制"))
                              .catch(() => notice("请手动复制标识。", true))
                          }
                        >
                          <Copy size={15} />
                        </button>
                      </div>
                      <h3>接入端点</h3>
                      <div className="studio-endpoints">
                        <span>
                          REST <code>/api/v1</code>
                        </span>
                        <span>
                          MCP <code>/mcp</code>
                        </span>
                      </div>
                      <p className="studio-sub">
                        令牌由执行器注入 Authorization: Bearer。OAuth
                        使用预注册客户端和显式授权。
                      </p>
                      <button
                        className="button secondary full"
                        onClick={onSettings}
                      >
                        <KeyRound size={15} />
                        令牌与 OAuth 设置
                      </button>
                    </>
                  )}
                  <div className="studio-detail-actions vertical">
                    <button
                      className="button primary"
                      disabled={busy || !selected.active}
                      onClick={() => void issue(selected)}
                    >
                      <KeyRound size={16} />
                      为此 Agent 生成令牌
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => setConfirm(selected)}
                    >
                      {selected.active ? "停用访问" : "重新启用"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="studio-detail-placeholder compact">
                <ShieldCheck size={33} />
                <h3>最小权限，明确边界。</h3>
                <p>选择一个 Agent，查看它被允许访问的项目和数据操作。</p>
              </div>
            )}
            <div className="studio-access-guide">
              <h3>
                <ShieldCheck size={17} />
                安全接入
              </h3>
              <p>
                令牌仅显示一次，放入执行器密钥配置。不要写入正文或模型提示词。
              </p>
              <a href="/docs/agents" target="_blank" rel="noreferrer">
                阅读接入指南
                <ArrowUpRight size={14} />
              </a>
              <a href="/openapi.json" target="_blank" rel="noreferrer">
                OpenAPI 契约
                <ArrowUpRight size={14} />
              </a>
            </div>
          </aside>
        </div>
      )}
      {inspectedRequest && (
        <Modal title="调用诊断" onClose={() => setInspectedRequest(null)}>
          <div className="modal-body">
            <dl className="studio-dl">
              <div>
                <dt>操作</dt>
                <dd>{inspectedRequest.operation}</dd>
              </div>
              <div>
                <dt>HTTP 状态</dt>
                <dd>{inspectedRequest.status}</dd>
              </div>
              <div>
                <dt>错误码</dt>
                <dd>{inspectedRequest.code ?? "无"}</dd>
              </div>
              <div>
                <dt>耗时</dt>
                <dd>{inspectedRequest.duration_ms} ms</dd>
              </div>
              <div>
                <dt>记录时间</dt>
                <dd>{formatDate(inspectedRequest.created_at)}</dd>
              </div>
            </dl>
            <div className="studio-copy-id">
              <code>{inspectedRequest.request_id}</code>
              <button
                className="icon-button"
                aria-label="复制请求 ID"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(inspectedRequest.request_id)
                    .then(() => notice("请求 ID 已复制"))
                    .catch(() => notice("请手动复制请求 ID。", true))
                }
              >
                <Copy size={15} />
              </button>
            </div>
            <p className="studio-sub">
              诊断记录不包含请求正文、令牌或未记录的上游执行步骤。
            </p>
          </div>
        </Modal>
      )}
      {open && data && (
        <Modal title="创建 Agent 身份" onClose={() => !busy && setOpen(false)}>
          <form className="modal-body" onSubmit={create}>
            <label className="field">
              名称
              <input
                autoFocus
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：项目 A 调研助手"
              />
            </label>
            <label className="field">
              权限模板
              <select
                value={
                  Object.keys(presets).find(
                    (k) =>
                      presets[k].length === scopes.length &&
                      presets[k].every((s) => scopes.includes(s)),
                  ) ?? "custom"
                }
                onChange={(e) => {
                  if (presets[e.target.value])
                    setScopes(presets[e.target.value]);
                }}
              >
                <option value="custom" disabled>
                  自定义权限
                </option>
                {Object.keys(presets).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <fieldset className="agent-fieldset">
              <legend>可访问项目</legend>
              {data.projects.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={projects.includes(p.id)}
                    onChange={(e) =>
                      setProjects((v) =>
                        e.target.checked
                          ? [...v, p.id]
                          : v.filter((id) => id !== p.id),
                      )
                    }
                  />
                  {p.name}
                </label>
              ))}
            </fieldset>
            <fieldset className="agent-fieldset">
              <legend>允许的操作</legend>
              {data.scopes.map((s) => (
                <label key={s}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(s)}
                    onChange={(e) =>
                      setScopes((v) =>
                        e.target.checked ? [...v, s] : v.filter((x) => x !== s),
                      )
                    }
                  />
                  {scopeLabels[s] ?? s}
                </label>
              ))}
            </fieldset>
            <p className="fine-print">
              不包含外部发文、凭证读取或管理其他 Agent 的权限。
            </p>
            <button
              className="button primary full"
              disabled={busy || !scopes.length || !projects.length}
            >
              {busy ? <Spinner /> : <ShieldCheck size={16} />}创建身份
            </button>
          </form>
        </Modal>
      )}
      {secret && (
        <Modal title="保存你的 Agent 令牌" onClose={() => setSecret("")}>
          <div className="modal-body">
            <p>
              仅此时可见。请存入执行器的密钥配置，不要粘贴到公开文档或模型提示词。
            </p>
            <textarea
              className="agent-secret"
              aria-label="新 Agent 令牌"
              readOnly
              value={secret}
            />
            <button
              className="button primary full"
              onClick={() =>
                void navigator.clipboard
                  .writeText(secret)
                  .then(() => notice("令牌已复制"))
                  .catch(() => notice("复制失败，请手动选择令牌复制。", true))
              }
            >
              <Copy size={16} />
              复制令牌
            </button>
            <p className="fine-print">
              REST 与 MCP 均使用 Authorization: Bearer。关闭后无法再次查看。
            </p>
          </div>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={confirm.active ? "停用 Agent 访问？" : "重新启用 Agent？"}
          onClose={() => !busy && setConfirm(null)}
        >
          <div className="modal-body">
            <p>
              {confirm.active
                ? `「${confirm.name}」的所有令牌将无法发起后续请求，已有数据和历史记录不删除。`
                : `「${confirm.name}」仍有效且未撤销的令牌将恢复访问，请确认仍信任该执行器。`}
            </p>
            <button
              className="button primary full"
              onClick={() => void toggle()}
              disabled={busy}
            >
              {busy ? <Spinner /> : null}确认{confirm.active ? "停用" : "启用"}
            </button>
          </div>
        </Modal>
      )}
      {projectOpen && (
        <Modal title="新建项目" onClose={() => !busy && setProjectOpen(false)}>
          <form
            className="modal-body"
            onSubmit={(e) => {
              e.preventDefault();
              const name = new FormData(e.currentTarget).get("name");
              setBusy(true);
              void request("projects", "POST", { name })
                .then(() => {
                  setProjectOpen(false);
                  return refresh();
                })
                .catch((e) => notice(e.message, true))
                .finally(() => setBusy(false));
            }}
          >
            <label className="field">
              项目名称
              <input name="name" required maxLength={100} autoFocus />
            </label>
            <p className="fine-print">
              新项目不会自动授予现有 Agent。为该项目创建一个明确授权的新身份。
            </p>
            <button className="button primary full" disabled={busy}>
              创建项目
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function LayersIcon() {
  return <Folder size={22} />;
}
