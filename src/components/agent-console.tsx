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
  Folder,
  Activity,
  X,
  Check,
  ArrowRight,
} from "lucide-react";
import { Modal, Spinner, type Notice, formatDate } from "./ui";
import {
  CopyButton,
  PageHeading,
  PanelHeading,
  QueryInput,
  Metric,
  RequestTable,
  safeDate,
} from "./studio/shared";
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
export function AgentConsole({ notice }: { notice: Notice }) {
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
  const [projectFilter, setProjectFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [detailTab, setDetailTab] = useState("permissions");
  const [mobileDetail, setMobileDetail] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setData(await request<Admin>("admin"));
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
      await request("agents", "POST", { name, scopes, project_ids: projects });
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
  const visible = (data?.agents ?? []).filter(
    (a) =>
      (projectFilter === "all" || a.project_ids.includes(projectFilter)) &&
      (statusFilter === "all" ||
        (statusFilter === "active" ? a.active : !a.active)) &&
      `${a.name} ${a.id}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const selected = visible.find((a) => a.id === selectedId) ?? visible[0];
  const selectedRequests =
    data?.requests.filter((r) => r.principal_id === selected?.id) ?? [];
  const activeProject = data?.projects.find((p) => p.id === projectFilter);
  return (
    <div className="agent-console studio-agents">
      <PageHeading
        eyebrow="PROJECTS & ACCESS"
        title="项目与权限管理"
        description="连接你的 Agent，划定项目与操作边界。数据私有，协作有序。"
        actions={
          <>
            <button
              className="button secondary"
              onClick={() => setProjectOpen(true)}
              disabled={!data}
            >
              <Folder size={16} />
              新建项目
            </button>
            <button
              className="button primary"
              onClick={() => setOpen(true)}
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
        <div className="studio-loading">
          <Spinner />
          正在读取项目与访问授权…
        </div>
      )}
      {data && (
        <div
          className={`studio-agent-layout ${mobileDetail ? "detail-open" : ""}`}
        >
          <aside className="studio-panel project-directory">
            <PanelHeading title="项目空间" count={data.projects.length} />
            <button
              className={`studio-project-card ${projectFilter === "all" ? "selected" : ""}`}
              aria-pressed={projectFilter === "all"}
              onClick={() => setProjectFilter("all")}
            >
              <span className="studio-icon small tone-green">
                <Folder size={20} />
              </span>
              <span>
                <strong>全部项目</strong>
                <small>{data.agents.length} 个 Agent 身份</small>
              </span>
            </button>
            {data.projects.map((p, i) => (
              <button
                className={`studio-project-card ${projectFilter === p.id ? "selected" : ""}`}
                key={p.id}
                aria-pressed={projectFilter === p.id}
                onClick={() => setProjectFilter(p.id)}
              >
                <span
                  className={`studio-icon small tone-${["green", "violet", "blue", "amber"][i % 4]}`}
                >
                  <Folder size={20} />
                </span>
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {
                      data.agents.filter((a) => a.project_ids.includes(p.id))
                        .length
                    }{" "}
                    个获准身份
                  </small>
                  <small className="mono">
                    {p.id === "default" ? "默认项目" : p.id.slice(0, 12) + "…"}
                  </small>
                </span>
                <ArrowRight size={14} />
              </button>
            ))}
            <div className="studio-project-note">
              <ShieldCheck size={19} />
              <p>项目不会自动共享。创建身份时，仅授予必要范围。</p>
            </div>
            <a
              href="/docs/agents"
              className="studio-inline-link"
              target="_blank"
              rel="noreferrer"
            >
              接入指南 <ArrowUpRight size={15} />
            </a>
          </aside>
          <div className="studio-agent-main">
            <section className="studio-panel project-summary">
              <div className="project-summary-title">
                <span className="studio-icon tone-green">
                  <Folder size={26} />
                </span>
                <div>
                  <h2>{activeProject?.name ?? "你的 Agent 工作空间"}</h2>
                  <p>独立身份 · 最小授权 · 可追溯的读写</p>
                </div>
                <button
                  className="icon-button"
                  aria-label="刷新"
                  title="刷新"
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={17} />
                </button>
              </div>
              <div className="project-summary-stats">
                <div>
                  <strong>{visible.length}</strong>
                  <span>筛选后身份</span>
                </div>
                <div>
                  <strong>{visible.filter((a) => a.active).length}</strong>
                  <span>已授权</span>
                </div>
                <div>
                  <strong>{visible.filter((a) => !a.active).length}</strong>
                  <span>已停用</span>
                </div>
                <div>
                  <strong>{data.projects.length}</strong>
                  <span>项目空间</span>
                </div>
              </div>
            </section>
            <section className="studio-panel">
              <PanelHeading title="Agent 列表" count={visible.length} />
              <div className="studio-browser-toolbar">
                <QueryInput
                  label="搜索 Agent"
                  placeholder="搜索 Agent 名称或 ID…"
                  value={query}
                  onChange={setQuery}
                />
                <select
                  aria-label="Agent 授权状态筛选"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">全部状态</option>
                  <option value="active">已授权</option>
                  <option value="inactive">已停用</option>
                </select>
              </div>
              {visible.length ? (
                <div className="studio-table-scroll">
                  <table className="studio-table studio-agent-table">
                    <thead>
                      <tr>
                        <th>Agent 名称</th>
                        <th>项目 / 权限</th>
                        <th>授权</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((a, i) => (
                        <tr
                          key={a.id}
                          className={`agent-card ${selected?.id === a.id ? "selected" : ""}`}
                        >
                          <td>
                            <button
                              className="studio-identity"
                              aria-pressed={selected?.id === a.id}
                              onClick={() => {
                                setSelectedId(a.id);
                                setMobileDetail(true);
                              }}
                            >
                              <span
                                className={`studio-icon small tone-${["green", "blue", "violet", "amber"][i % 4]}`}
                              >
                                <Bot size={20} />
                              </span>
                              <span>
                                <strong>{a.name}</strong>
                                <small className="mono">
                                  {a.id.slice(0, 12)}…
                                </small>
                              </span>
                            </button>
                          </td>
                          <td>
                            <div className="studio-chip-wrap">
                              {a.project_ids.slice(0, 2).map((id) => (
                                <span className="studio-chip blue" key={id}>
                                  {data.projects.find((p) => p.id === id)
                                    ?.name ?? id}
                                </span>
                              ))}
                            </div>
                            <small>
                              {a.scopes.length} 项操作权限
                              {a.project_ids.length > 2
                                ? ` · ${a.project_ids.length} 个项目`
                                : ""}
                            </small>
                          </td>
                          <td>
                            <span
                              className={`studio-status ${a.active ? "enabled" : "disabled"}`}
                            >
                              <i />
                              {a.active ? "已授权" : "已停用"}
                            </span>
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              aria-label="生成令牌"
                              title="生成令牌"
                              disabled={busy || !a.active}
                              onClick={() => void issue(a)}
                            >
                              <KeyRound size={16} />
                            </button>
                            <button
                              className="text-button"
                              onClick={() => setConfirm(a)}
                            >
                              {a.active ? "停用访问" : "重新启用"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="agent-empty">
                  <Bot size={32} />
                  <h3>
                    {data.agents.length
                      ? "没有符合筛选的 Agent"
                      : "从第一个调研或写作 Agent 开始"}
                  </h3>
                  <p>
                    {data.agents.length
                      ? "调整名称、项目或授权状态筛选。"
                      : "先选择项目，再开放最少必要的权限。不会自动连接外部账号。"}
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      if (data.agents.length) {
                        setProjectFilter("all");
                        setQuery("");
                        setStatusFilter("all");
                      } else setOpen(true);
                    }}
                  >
                    {data.agents.length ? "清除 Agent 筛选" : "创建 Agent 身份"}
                  </button>
                </div>
              )}
              <div className="studio-panel-foot">
                <ShieldCheck size={14} />
                这里显示访问授权，不代表 Agent 正在运行。
              </div>
            </section>
            <section className="studio-panel">
              <PanelHeading
                title="最近调用"
                action={<span className="studio-caption">最近最多 30 条</span>}
              />
              <RequestTable requests={data.requests} agents={data.agents} />
              <div className="studio-panel-foot">
                仅记录诊断元信息，不记录正文和令牌。不是全量访问审计。
              </div>
            </section>
          </div>
          <aside
            className="studio-panel studio-inspector agent-inspector"
            aria-label="Agent 权限详情"
          >
            <div className="studio-inspector-head">
              <div>
                <span className="studio-eyebrow">ACCESS CONTROL</span>
                <h2>权限与接入配置</h2>
              </div>
              <button
                className="icon-button mobile-detail-close"
                aria-label="返回 Agent 列表"
                onClick={() => setMobileDetail(false)}
              >
                <X size={18} />
              </button>
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
                接入配置
              </button>
            </div>
            <div className="studio-inspector-body">
              {selected ? (
                <>
                  <div className="selected-agent-identity">
                    <span className="studio-icon tone-green">
                      <Bot size={23} />
                    </span>
                    <div>
                      <h3>{selected.name}</h3>
                      <span
                        className={`studio-status ${selected.active ? "enabled" : "disabled"}`}
                      >
                        <i />
                        {selected.active ? "已授权" : "已停用"}
                      </span>
                    </div>
                  </div>
                  {detailTab === "permissions" ? (
                    <>
                      <section className="detail-section">
                        <h3>允许的操作</h3>
                        <div className="permission-list">
                          {data.scopes.map((scope) => (
                            <div
                              key={scope}
                              className={
                                selected.scopes.includes(scope)
                                  ? "granted"
                                  : "not-granted"
                              }
                            >
                              <span className="permission-check">
                                {selected.scopes.includes(scope) ? (
                                  <Check size={14} />
                                ) : (
                                  <X size={13} />
                                )}
                              </span>
                              <span>
                                <strong>{scopeLabels[scope] ?? scope}</strong>
                                <small className="mono">{scope}</small>
                              </span>
                              <span>
                                {selected.scopes.includes(scope)
                                  ? "已授权"
                                  : "未授权"}
                              </span>
                            </div>
                          ))}
                        </div>
                        <p className="studio-caption">
                          此处只读。变更项目或操作范围，请建立新身份并停用旧身份；不静默扩大已有令牌权限。
                        </p>
                      </section>
                      <section className="detail-section">
                        <h3>项目访问范围</h3>
                        <div className="studio-chip-wrap">
                          {selected.project_ids.map((id) => (
                            <span key={id} className="studio-chip blue">
                              <Folder size={13} />
                              {data.projects.find((p) => p.id === id)?.name ??
                                id}
                            </span>
                          ))}
                        </div>
                      </section>
                    </>
                  ) : (
                    <>
                      <section className="detail-section">
                        <h3>独立 Agent 身份</h3>
                        <div className="copy-line">
                          <code>{selected.id}</code>
                          <CopyButton
                            value={selected.id}
                            label="复制 Agent ID"
                            notice={notice}
                          />
                        </div>
                        <p>令牌由执行器安全注入，不写入模型提示词或正文。</p>
                        <button
                          className="button primary full"
                          disabled={busy || !selected.active}
                          onClick={() => void issue(selected)}
                        >
                          <KeyRound size={16} />
                          生成独立令牌
                        </button>
                        <p className="studio-caption">
                          新令牌不会自动撤销旧令牌。单独撤销请前往“连接与设置”。
                        </p>
                      </section>
                      <section className="detail-section">
                        <h3>统一连接入口</h3>
                        <div className="endpoint-row">
                          <span>REST</span>
                          <code>/api/v1</code>
                        </div>
                        <div className="endpoint-row">
                          <span>MCP</span>
                          <code>/mcp</code>
                        </div>
                        <div className="endpoint-row">
                          <span>发现</span>
                          <code>/api/v1/capabilities</code>
                        </div>
                        <a
                          className="studio-inline-link"
                          href="/docs/agents"
                          target="_blank"
                          rel="noreferrer"
                        >
                          OAuth 与安全接入说明 <ArrowUpRight size={15} />
                        </a>
                        <a
                          className="studio-inline-link"
                          href="/openapi.json"
                          target="_blank"
                          rel="noreferrer"
                        >
                          查看 OpenAPI 契约 <ArrowUpRight size={15} />
                        </a>
                      </section>
                    </>
                  )}
                  <section className="detail-section">
                    <h3>最近活动</h3>
                    {selectedRequests.length ? (
                      <>
                        <strong className="mono">
                          {selectedRequests[0].operation}
                        </strong>
                        <p>
                          {safeDate(selectedRequests[0].created_at)} ·{" "}
                          {selectedRequests[0].status < 400
                            ? "请求成功"
                            : "请求失败"}
                        </p>
                      </>
                    ) : (
                      <p className="muted">
                        最近 30 条调用中没有该身份记录。不代表从未调用。
                      </p>
                    )}
                  </section>
                  <div className="studio-security-note">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>凭证留在执行器，数据留在 Hub。</strong>
                      <p>本平台不向模型返回平台凭证，也不会自动发文。</p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="studio-empty-compact">
                  创建或选择一个身份，查看它的实际项目与操作权限。
                </div>
              )}
            </div>
          </aside>
        </div>
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
