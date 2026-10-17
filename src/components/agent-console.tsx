"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Bot,
  ShieldCheck,
  KeyRound,
  ArrowUpRight,
  RefreshCw,
  Plus,
  Copy,
  Check,
  Activity,
  Folder,
  AlertTriangle,
} from "lucide-react";
import { api, Modal, Spinner, formatDate, type Notice } from "./ui";
type Agent = {
  id: string;
  name: string;
  project_ids: string[];
  scopes: string[];
  revoked_at: string | null;
  active_keys: number;
  last_call_at: string | null;
};
type ConsoleData = {
  projects: { id: string; name: string }[];
  agents: Agent[];
  calls: {
    request_id: string;
    actor_id: string;
    operation: string;
    project_id: string | null;
    status: number;
    code: string | null;
    replayed: boolean;
    created_at: string;
  }[];
  permissions: string[];
};
const labels: Record<string, string> = {
  "source:read": "读取来源",
  "source:write": "保存来源",
  "content:read": "读取正文",
  "content:write": "创建与修改正文",
  "file:read": "读取文件",
  "file:write": "上传文件",
  "artifact:read": "读取产物",
  "artifact:write": "登记产物",
  "changes:read": "读取变更",
};
export function AgentConsole({ notice }: { notice: Notice }) {
  const [data, setData] = useState<ConsoleData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dialog, setDialog] = useState<"agent" | "project" | null>(null);
  const [secret, setSecret] = useState<{ token: string; name: string } | null>(
      null,
    ),
    [confirm, setConfirm] = useState<{
      agent: Agent;
      action: "rotate" | "revoke";
    } | null>(null);
  const [projects, setProjects] = useState<string[]>(["default"]),
    [scopes, setScopes] = useState<string[]>([
      "source:read",
      "content:read",
      "file:read",
      "artifact:read",
      "changes:read",
    ]),
    [copied, setCopied] = useState(false),
    [origin, setOrigin] = useState("");
  const refresh = useCallback(async () => {
    try {
      const result = await api<{ data: ConsoleData }>("v1/admin");
      setData(result.data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    setOrigin(window.location.origin);
    void refresh();
  }, [refresh]);
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      notice("已复制");
    } catch {
      notice("浏览器未允许访问剪贴板，请选中文本后复制。", true);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (dialog === "project") {
        await api("v1/admin/projects", "POST", { name: form.get("name") });
        setDialog(null);
        await refresh();
        notice("项目已创建；尚未向任何 Agent 授权。");
      } else {
        const r = await api<{
          data: { id: string; name: string; token: string };
        }>("v1/admin/agents", "POST", {
          name: form.get("name"),
          project_ids: projects,
          scopes,
        });
        setSecret({ name: r.data.name, token: r.data.token });
        setCopied(false);
        setDialog(null);
        await refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mutate() {
    if (!confirm) return;
    setBusy(true);
    try {
      const r = await api<{ data: { token?: string } }>(
        "v1/admin/agents/" + confirm.agent.id + "/" + confirm.action,
        "POST",
        {},
      );
      if (r.data.token) {
        setSecret({ name: confirm.agent.name, token: r.data.token });
        setCopied(false);
      } else notice("Agent 已撤销，后续请求会被拒绝。");
      setConfirm(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const toggle = (values: string[], value: string) =>
    values.includes(value)
      ? values.filter((v) => v !== value)
      : [...values, value];
  if (!data && !error)
    return (
      <section className="agent-console">
        <p role="status">
          <Spinner /> 正在读取连接与调用记录…
        </p>
      </section>
    );
  return (
    <section className="agent-console">
      <header className="agent-page-header">
        <div>
          <div className="eyebrow">AGENT DATA GATEWAY · V1.1</div>
          <h1>Agent 管理台</h1>
          <p>数据在这里汇合，权限和每次修改都有记录。</p>
        </div>
        <div className="agent-actions">
          <button
            className="button secondary"
            onClick={() => void refresh()}
            aria-label="刷新 Agent 管理台"
          >
            <RefreshCw size={16} />
          </button>
          <button
            className="button secondary"
            onClick={() => setDialog("project")}
          >
            <Folder size={16} />
            新建项目
          </button>
          <button
            className="button primary"
            onClick={() => {
              setError("");
              setDialog("agent");
            }}
          >
            <Plus size={16} />
            连接 Agent
          </button>
        </div>
      </header>
      {error && (
        <div className="agent-error" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
          <button className="text-button" onClick={() => void refresh()}>
            重新加载
          </button>
        </div>
      )}
      <div className="agent-overview">
        <div>
          <Bot size={20} />
          <strong>
            {data?.agents.filter((a) => !a.revoked_at).length ?? 0}
          </strong>
          <span>已授权 Agent</span>
          <small>授权不代表当前在线</small>
        </div>
        <div>
          <Folder size={20} />
          <strong>{data?.projects.length ?? 0}</strong>
          <span>独立项目</span>
          <small>范围明确，不跨项目读写</small>
        </div>
        <div>
          <Activity size={20} />
          <strong>{data?.calls.length ?? 0}</strong>
          <span>最近调用</span>
          <small>展示最近 50 条，不是全量统计</small>
        </div>
      </div>
      <div className="agent-connect-panel">
        <div>
          <ShieldCheck size={23} />
          <h2>一次授权，两种接入方式</h2>
          <p>
            REST 和 MCP
            共用权限、版本与幂等记录。密钥保存在执行器里，不要写进提示词、正文或仓库。
          </p>
        </div>
        <div className="agent-endpoints">
          <label>
            REST API<code>{origin}/api/v1</code>
          </label>
          <label>
            MCP · Streamable HTTP<code>{origin}/mcp</code>
          </label>
          <a href="/docs/agents" target="_blank" rel="noreferrer">
            接入指南
            <ArrowUpRight size={16} />
          </a>
          <a href="/openapi.json" target="_blank" rel="noreferrer">
            OpenAPI 契约
            <ArrowUpRight size={16} />
          </a>
        </div>
      </div>
      <div className="agent-section-title">
        <h2>连接与访问范围</h2>
        <span>新令牌有效期 90 天 · 可轮换或撤销</span>
      </div>
      {data?.agents.length ? (
        <div className="agent-grid">
          {data.agents.map((a) => (
            <article className="agent-card" key={a.id}>
              <div className="agent-card-heading">
                <span className="agent-avatar">
                  <Bot size={22} />
                </span>
                <div>
                  <h3>{a.name}</h3>
                  <p>
                    {a.revoked_at
                      ? "已撤销"
                      : a.active_keys > 0
                        ? "已授权"
                        : "无有效密钥"}
                  </p>
                </div>
              </div>
              <div className="agent-tags">
                {a.project_ids.map((id) => (
                  <span key={id}>
                    <Folder size={12} />
                    {data.projects.find((p) => p.id === id)?.name ?? id}
                  </span>
                ))}
              </div>
              <p className="agent-scopes">
                {a.scopes.map((s) => labels[s] ?? s).join(" · ")}
              </p>
              <div className="agent-card-footer">
                <span>
                  {a.last_call_at
                    ? "最近调用 " + formatDate(a.last_call_at)
                    : "尚无调用记录"}
                </span>
                {!a.revoked_at && (
                  <div>
                    <button
                      onClick={() => setConfirm({ agent: a, action: "rotate" })}
                    >
                      轮换密钥
                    </button>
                    <button
                      className="danger"
                      onClick={() => setConfirm({ agent: a, action: "revoke" })}
                    >
                      撤销
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="agent-empty">
          <Bot size={34} />
          <h3>连接第一个 Agent</h3>
          <p>
            先选项目和最小权限，再把令牌交给你的执行器。它可以通过 REST 或 MCP
            使用同一份数据。
          </p>
          <button className="button primary" onClick={() => setDialog("agent")}>
            创建独立授权
          </button>
        </div>
      )}
      <div className="agent-section-title">
        <h2>最近的接口调用</h2>
        <span>只记录身份、操作与结果，不记录令牌或请求正文</span>
      </div>
      <div className="agent-call-list">
        {data?.calls.length ? (
          data.calls.map((c) => (
            <article className="agent-call" key={c.request_id}>
              <span
                className={
                  "agent-status " + (c.status >= 400 ? "failed" : "ok")
                }
              >
                {c.status >= 400 ? "失败" : "成功"}
              </span>
              <div>
                <strong>{c.operation}</strong>
                <p>
                  {data.agents.find((a) => "agent:" + a.id === c.actor_id)
                    ?.name ?? c.actor_id}{" "}
                  · {formatDate(c.created_at)}
                  {c.replayed ? " · 幂等重放（未重复写入）" : ""}
                </p>
                {c.code && <code>{c.code}</code>}
              </div>
              <button
                title="复制请求 ID"
                aria-label="复制请求 ID"
                onClick={() => void copy(c.request_id)}
              >
                <Copy size={15} />
                <span>{c.request_id.slice(0, 8)}</span>
              </button>
            </article>
          ))
        ) : (
          <div className="agent-empty compact">
            <p>暂无调用记录。用接入指南里的 capabilities 请求验证连接。</p>
          </div>
        )}
      </div>
      <p className="agent-boundary">
        兼容说明：旧版全库令牌与 OAuth 继续使用旧接口／只读
        MCP；不会自动升级为项目范围写权限。新 API 暂不包含自动发文、后台任务和
        URL 抓取。
      </p>
      {dialog && (
        <Modal
          title={dialog === "agent" ? "创建 Agent 授权" : "创建独立项目"}
          onClose={() => {
            if (!busy) setDialog(null);
          }}
        >
          <form className="modal-body agent-form" onSubmit={submit}>
            <label className="field">
              {dialog === "agent" ? "Agent 名称" : "项目名称"}
              <input
                name="name"
                required
                autoFocus
                maxLength={80}
                placeholder={
                  dialog === "agent"
                    ? "例如：技术文章调研 Agent"
                    : "例如：内容项目 A"
                }
              />
            </label>
            {dialog === "agent" && (
              <>
                <fieldset>
                  <legend>允许访问的项目</legend>
                  {data?.projects.map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        checked={projects.includes(p.id)}
                        onChange={() => setProjects(toggle(projects, p.id))}
                      />
                      {p.name}
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>操作权限</legend>
                  <div className="scope-presets">
                    <button
                      type="button"
                      onClick={() =>
                        setScopes([
                          "source:read",
                          "content:read",
                          "file:read",
                          "artifact:read",
                          "changes:read",
                        ])
                      }
                    >
                      只读
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setScopes([
                          "source:read",
                          "source:write",
                          "content:read",
                          "changes:read",
                        ])
                      }
                    >
                      调研
                    </button>
                    <button
                      type="button"
                      onClick={() => setScopes(data?.permissions ?? [])}
                    >
                      内容协作
                    </button>
                  </div>
                  {data?.permissions.map((s) => (
                    <label key={s}>
                      <input
                        type="checkbox"
                        checked={scopes.includes(s)}
                        onChange={() => setScopes(toggle(scopes, s))}
                      />
                      {labels[s]}
                    </label>
                  ))}
                </fieldset>
                <p className="fine-print">
                  登记产物还需要“读取正文”和“读取文件”。不包含平台发布权限。
                </p>
              </>
            )}
            {error && (
              <p role="alert" className="agent-error">
                {error}
              </p>
            )}
            <button
              className="button primary full"
              disabled={
                busy ||
                (dialog === "agent" && (!projects.length || !scopes.length))
              }
            >
              {busy ? <Spinner /> : <KeyRound size={16} />}{" "}
              {dialog === "agent" ? "创建授权并显示密钥" : "创建项目"}
            </button>
          </form>
        </Modal>
      )}
      {secret && (
        <Modal
          title={"保存 " + secret.name + " 的密钥"}
          onClose={() => {
            if (
              window.confirm(
                "密钥只显示这一次。确认已保存或准备轮换后重新获取？",
              )
            )
              setSecret(null);
          }}
        >
          <div className="modal-body agent-secret">
            <p>
              密钥仅在这里显示一次。请保存在执行器的环境变量或密码管理器中，不要写入公开仓库。
            </p>
            <label className="field">
              Agent Bearer Token
              <textarea readOnly value={secret.token} rows={3} />
            </label>
            <button
              className="button secondary full"
              onClick={() => void copy(secret.token)}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}复制密钥
            </button>
            <pre>
              curl -H 'Authorization: Bearer YOUR_TOKEN' \\
              {`\n  ${origin}/api/v1/capabilities`}
            </pre>
            <button
              className="button primary full"
              onClick={() => setSecret(null)}
            >
              我已保存，关闭密钥
            </button>
          </div>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={
            confirm.action === "revoke" ? "撤销 Agent 授权" : "轮换 Agent 密钥"
          }
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <div className="modal-body">
            <p>
              {confirm.action === "revoke"
                ? `撤销 ${confirm.agent.name} 后，后续请求会被拒绝。历史数据和审计记录不会删除。`
                : `轮换 ${confirm.agent.name} 会使旧密钥失效，Agent 身份和幂等记录保留。需要更新执行器中的密钥。`}
            </p>
            <button
              className="button primary full"
              disabled={busy}
              onClick={() => void mutate()}
            >
              {busy ? <Spinner /> : <KeyRound size={16} />}确认
              {confirm.action === "revoke" ? "撤销" : "轮换"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
