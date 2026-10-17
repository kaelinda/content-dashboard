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
} from "lucide-react";
import { Modal, Spinner, type Notice, formatDate } from "./ui";
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
  return (
    <div className="agent-console">
      <header className="agent-header">
        <div>
          <div className="eyebrow">AGENT DATA GATEWAY</div>
          <h1>让 Agent 协作，让数据有据。</h1>
          <p>同一份资料，跨工具复用。你决定谁能读取、写入和检查。</p>
        </div>
        <button
          className="button primary"
          onClick={() => setOpen(true)}
          disabled={!data}
        >
          <Plus size={17} />
          连接新 Agent
        </button>
      </header>
      <div className="agent-principles">
        <span>
          <ShieldCheck size={16} />
          项目与操作双重授权
        </span>
        <span>重试不重复写入</span>
        <span>正文与产物保留版本</span>
        <span>不向模型返回平台凭证</span>
      </div>
      <section className="panel agent-quickstart">
        <div>
          <h2>
            <FileCode2 size={19} /> 从一个统一入口开始
          </h2>
          <p>
            先读取 capabilities，确认项目和权限。HTTP 与 MCP
            的写入会经过同一套校验。
          </p>
          <code>GET /api/v1/capabilities</code>
        </div>
        <div className="agent-links">
          <a
            className="button secondary"
            href="/docs/agents"
            target="_blank"
            rel="noreferrer"
          >
            接入指南
            <ArrowUpRight size={15} />
          </a>
          <a
            className="button secondary"
            href="/openapi.json"
            target="_blank"
            rel="noreferrer"
          >
            OpenAPI
            <ArrowUpRight size={15} />
          </a>
        </div>
      </section>
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <button className="text-button" onClick={() => void refresh()}>
            重新加载
          </button>
        </div>
      )}
      {!data && !error ? (
        <Spinner />
      ) : (
        data && (
          <>
            <section className="panel agent-section">
              <div className="panel-heading">
                <h2>
                  <Bot size={19} /> Agent 身份{" "}
                  <span className="agent-count">{data.agents.length}</span>
                </h2>
                <button className="text-button" onClick={() => void refresh()}>
                  <RefreshCw size={15} />
                  刷新
                </button>
              </div>
              <p className="muted">
                这里显示授权状态，不代表 Agent
                正在运行。一个身份可以持有多个令牌，幂等记录不随令牌轮换丢失。
              </p>
              {!data.agents.length ? (
                <div className="agent-empty">
                  <Bot size={32} />
                  <h3>从第一个调研或写作 Agent 开始</h3>
                  <p>
                    先选择它能访问的项目，再开放最少必要的权限。不会自动连接任何外部账号。
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => setOpen(true)}
                  >
                    创建 Agent 身份
                  </button>
                </div>
              ) : (
                <div className="agent-list">
                  {data.agents.map((a) => (
                    <article key={a.id} className="agent-card">
                      <div className="agent-card-title">
                        <span className="agent-avatar">
                          <Bot size={22} />
                        </span>
                        <div>
                          <h3>{a.name}</h3>
                          <small className="mono">{a.id}</small>
                        </div>
                        <span
                          className={
                            "agent-status " +
                            (a.active ? "enabled" : "disabled")
                          }
                        >
                          {a.active ? "已授权" : "已停用"}
                        </span>
                      </div>
                      <p className="agent-projects">
                        {a.project_ids
                          .map(
                            (id) =>
                              data.projects.find((p) => p.id === id)?.name ??
                              id,
                          )
                          .join(" · ")}
                      </p>
                      <div className="agent-scopes">
                        {a.scopes.map((s) => (
                          <span key={s}>{scopeLabels[s] ?? s}</span>
                        ))}
                      </div>
                      <div className="agent-card-actions">
                        <button
                          className="button secondary"
                          disabled={busy || !a.active}
                          onClick={() => void issue(a)}
                        >
                          <KeyRound size={15} />
                          生成令牌
                        </button>
                        <button
                          className="text-button"
                          onClick={() => setConfirm(a)}
                        >
                          {a.active ? "停用访问" : "重新启用"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
            <section className="panel agent-section">
              <div className="panel-heading">
                <h2>项目边界</h2>
                <button
                  className="text-button"
                  onClick={() => setProjectOpen(true)}
                >
                  <Plus size={15} />
                  新建项目
                </button>
              </div>
              <div className="agent-project-list">
                {data.projects.map((p) => (
                  <div key={p.id}>
                    <strong>{p.name}</strong>
                    <code>{p.id}</code>
                  </div>
                ))}
              </div>
            </section>
            <section className="panel agent-section">
              <div className="panel-heading">
                <h2>最近调用</h2>
                <span className="muted">最近 30 条 · 不记录正文和令牌</span>
              </div>
              {data.requests.length ? (
                <div className="agent-table-wrap">
                  <table className="agent-table">
                    <thead>
                      <tr>
                        <th>操作 / 请求 ID</th>
                        <th>身份</th>
                        <th>结果</th>
                        <th>耗时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.requests.map((r) => (
                        <tr key={r.request_id}>
                          <td>
                            <strong>{r.operation}</strong>
                            <small className="mono">{r.request_id}</small>
                            <small>{formatDate(r.created_at)}</small>
                          </td>
                          <td>
                            {data.agents.find((a) => a.id === r.principal_id)
                              ?.name ?? r.principal_id}
                          </td>
                          <td>
                            <span
                              className={
                                r.status < 400 ? "request-ok" : "request-failed"
                              }
                            >
                              {r.status < 400 ? "成功" : (r.code ?? "失败")}
                            </span>
                          </td>
                          <td>{r.duration_ms} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="agent-empty">
                  还没有 Agent 业务调用。接入后可在此核查请求结果。
                </p>
              )}
            </section>
          </>
        )
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
