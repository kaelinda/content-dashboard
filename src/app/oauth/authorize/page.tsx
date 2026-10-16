"use client";
import { useEffect, useState } from "react";
import { LockKeyhole, Check, ArrowLeft } from "lucide-react";
import { api, Spinner } from "@/components/ui";
export default function Authorize() {
  const [client, setClient] = useState<{
      name: string;
      scope: string;
      redirect_uri: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const auth = await api<{ authenticated: boolean }>("auth/status");
        if (!auth.authenticated) {
          window.location.href =
            "/?returnTo=" +
            encodeURIComponent(
              window.location.pathname + window.location.search,
            );
          return;
        }
        setClient(await api("oauth/authorize" + window.location.search));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);
  async function approve() {
    setBusy(true);
    try {
      const result = await api<{ redirect: string }>(
        "oauth/authorize",
        "POST",
        { query: window.location.search },
      );
      window.location.href = result.redirect;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="consent-card">
        <div className="consent-icon">
          <LockKeyhole size={28} />
        </div>
        <div className="eyebrow">CONTENT HUB · 授权确认</div>
        <h1>
          {client ? `允许 ${client.name} 读取内容库？` : "正在验证授权请求"}
        </h1>
        {error ? (
          <div className="inline-error" role="alert">
            {error}
          </div>
        ) : client ? (
          <>
            <p>仅授权当前注册的客户端。你可以在工作台的连接设置中随时撤销。</p>
            <div className="permission">
              <Check size={18} />
              <span>搜索和读取内容、信息源与引用关系</span>
            </div>
            <div className="inline-note">
              不允许写入正文、获取平台凭证或向外发布内容。
            </div>
            <small className="mono">回调地址：{client.redirect_uri}</small>
            <button
              className="button primary full"
              onClick={() => void approve()}
              disabled={busy}
            >
              {busy ? <Spinner /> : <LockKeyhole size={16} />}确认只读授权
            </button>
          </>
        ) : (
          <Spinner />
        )}
        <a href="/" className="text-button">
          <ArrowLeft size={15} />
          取消并返回工作台
        </a>
      </section>
    </main>
  );
}
