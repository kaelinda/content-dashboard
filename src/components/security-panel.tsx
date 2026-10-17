"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ShieldCheck, LogOut, Activity, RefreshCw } from "lucide-react";
import { api, formatDate, Modal, Spinner } from "./ui";
type Session = {
    id: string;
    created_at: string;
    expires_at: string;
    current: boolean;
};
type Access = {
    sessions: Session[];
    truncated: boolean;
    counts: {
        authorized_agents: number;
        unrevoked_credentials: number;
    };
};
type Diagnostic = {
    readiness: {
        ok: boolean;
        checked_at: string;
    };
    storage: {
        status: string;
        code: string;
    };
    migration_mode: string;
};
type Action = "session" | "other_sessions" | "agent_access" | "all_access";
const actions: Record<Action, {
    title: string;
    description: string;
}> = {
    session: { title: "撤销这个登录会话", description: "该会话的后续访问将被拒绝，不影响其他登录和 Agent。已执行的操作不会回滚。" },
    other_sessions: { title: "退出其他网页登录", description: "仅保留当前登录会话。其他网页登录将失效，Agent 令牌不受影响。" },
    agent_access: { title: "停用全部 Agent 访问", description: "停用全部 Agent 身份，并撤销全部 API 与 OAuth 凭证（含授权码和刷新令牌）。当前网页登录保留。恢复时必须重新授权并签发令牌。" },
    all_access: { title: "紧急撤销全部访问", description: "撤销所有网页登录、API 与 OAuth 凭证，并停用所有 Agent；当前会话也会退出。怀疑密码泄露时还必须在服务器轮换密码。" },
};
export function SecurityPanel({ onChanged }: {
    onChanged: () => Promise<void>;
}) {
    const [access, setAccess] = useState<Access | null>(null), [error, setError] = useState("");
    const [pending, setPending] = useState<{
        action: Action;
        tokenId?: string;
    } | null>(null);
    const [busy, setBusy] = useState(false), [result, setResult] = useState("");
    const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null), [probing, setProbing] = useState(false), [probeError, setProbeError] = useState("");
    const refresh = useCallback(async () => { try {
        setAccess(await api<Access>("security"));
        setError("");
    }
    catch {
        setError("无法读取登录状态，请重试；会话失效时需重新登录。");
    } }, []);
    useEffect(() => { void refresh(); }, [refresh]);
    async function revoke(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!pending || busy)
            return;
        const form = e.currentTarget;
        const password = String(new FormData(form).get("password") || "");
        setBusy(true);
        setError("");
        setResult("");
        try {
            const r = await api<{
                signed_out: boolean;
                revoked: number;
                disabled_agents: number;
            }>("security/revoke", "POST", { action: pending.action, password, ...(pending.tokenId ? { token_id: pending.tokenId } : {}) });
            setPending(null);
            if (r.signed_out) {
                window.location.assign("/");
                return;
            }
            setResult(`已撤销 ${r.revoked} 个凭证，停用 ${r.disabled_agents} 个 Agent。`);
            await refresh();
            try {
                await onChanged();
            }
            catch {
                setError("撤销已提交，但连接列表刷新失败，请刷新页面核对。");
            }
        }
        catch (err) {
            const code = (err as {
                code?: string;
            }).code;
            setError(code === "REAUTHENTICATION_FAILED" ? "密码不正确，未执行撤销。" : code === "RATE_LIMITED" ? "验证过于频繁，请按服务器要求等待后重试。" : "撤销结果尚未确认，请刷新列表核对；当前会话可能已失效，不要直接重复执行全量操作。");
        }
        finally {
            form.reset();
            setBusy(false);
        }
    }
    async function probe() {
        setProbing(true);
        setProbeError("");
        try {
            setDiagnostic(await api<Diagnostic>("health/diagnostics"));
        }
        catch {
            setProbeError("诊断无法完成，请检查会话和服务；没有输出配置或密钥。");
        }
        finally {
            setProbing(false);
        }
    }
    return <>
    <section className="panel settings-panel connections-panel security-panel" aria-label="安全与登录会话">
      <div className="panel-heading"><h2><ShieldCheck size={18}/>安全与登录会话</h2><button className="button secondary compact" onClick={() => void refresh()}><RefreshCw size={16}/>刷新会话</button></div>
      <p className="muted">登录密码与 Agent 凭证相互独立。改密会使旧网页登录失效，不会自动撤销 Agent 令牌。</p>
      {result && <p role="status" className="setting-info">{result}</p>}
      {error && !pending && <p role="alert" className="security-error">{error}</p>}
      {access ? <>
        <p className="fine-print">已授权 Agent {access.counts.authorized_agents} 个 · 未过期且未撤销的 API / OAuth 凭证 {access.counts.unrevoked_credentials} 个（不代表在线连接）。</p>
        <div className="connection-list">{access.sessions.map(s => <div className="connection-row" key={s.id}>
          <span className="connection-icon"><LogOut size={18}/></span>
          <div><strong>{s.current ? "当前登录" : "其他网页登录"}</strong><small>创建 {formatDate(s.created_at)} · 到期 {formatDate(s.expires_at)}</small><small>会话 ID {s.id.slice(0, 8)}…</small></div>
          <button className="button secondary compact" onClick={() => { setError(""); setPending({ action: "session", tokenId: s.id }); }}>撤销会话</button>
        </div>)}</div>
        {access.truncated && <p className="fine-print">仅显示最近 100 个有效会话；批量撤销覆盖全部匹配会话。</p>}
      </> : <p className="muted">正在读取登录状态…</p>}
      <div className="security-actions">
        <button className="button secondary" onClick={() => { setError(""); setPending({ action: "other_sessions" }); }}>退出其他网页登录</button>
        <button className="button secondary" onClick={() => { setError(""); setPending({ action: "agent_access" }); }}>停用全部 Agent 访问</button>
        <button className="button secondary danger" onClick={() => { setError(""); setPending({ action: "all_access" }); }}>紧急撤销全部访问</button>
      </div>
      <p className="fine-print">撤销阻止后续请求，不撤回已经开始的操作。所有敏感操作均需重新验证密码并写入审计记录。</p>
    </section>
    <section className="panel settings-panel security-panel" aria-label="服务诊断">
      <div className="panel-heading"><h2><Activity size={18}/>服务诊断</h2><button className="button secondary compact" disabled={probing} onClick={() => void probe()}>{probing ? <Spinner /> : <RefreshCw size={16}/>}检查服务</button></div>
      <p className="muted">只检查数据库、迁移一致性及一个已有文件的存储元信息。不会写入探测文件，不检测外部 Agent 或发布平台。</p>
      {probeError && <p role="alert" className="security-error">{probeError}</p>}
      {diagnostic && <>
        <div className="system-row"><span>数据库与迁移</span><strong>{diagnostic.readiness.ok ? "通过" : "未就绪"}</strong></div>
        <div className="system-row"><span>存储读取（抽样）</span><strong>{diagnostic.storage.status === "ok" ? "元信息可读" : diagnostic.storage.status === "not_checked" ? "尚未验证" : "读取失败"}</strong></div>
        <p className="fine-print">{diagnostic.storage.code === "NO_STORED_SAMPLE" ? "还没有已有文件可供抽查。" : "这不是存储写入或全部文件完整性证明。"} 迁移模式：{diagnostic.migration_mode}。</p>
        <p className="fine-print">数据库结果最多缓存 10 秒，存储结果最多缓存 30 秒。完整对账可在维护环境运行 npm run storage:reconcile -- --verify。</p>
      </>}
    </section>
    {pending && <Modal title={actions[pending.action].title} onClose={() => { if (!busy) {
            setPending(null);
            setError("");
        } }}>
      <form className="modal-form" onSubmit={revoke}>
        <p>{actions[pending.action].description}</p>
        <label className="field">当前工作区密码<input name="password" type="password" autoComplete="current-password" required maxLength={1024}/></label>
        <label className="security-confirm"><input type="checkbox" required/>我已了解影响，确认执行此操作。</label>
        {error && <p role="alert" className="security-error">{error}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => { setPending(null); setError(""); }}>取消</button><button className="button primary" disabled={busy}>{busy ? <Spinner /> : <ShieldCheck size={16}/>}验证密码并执行</button></div>
      </form>
    </Modal>}
  </>;
}
