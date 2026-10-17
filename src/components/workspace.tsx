"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  LayoutDashboard,
  Files,
  BookOpen,
  Image as ImageIcon,
  PackageCheck,
  Send,
  Plug,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronRight,
  Download,
  Upload,
  FileText,
  Link2,
  LockKeyhole,
  LogOut,
  Menu,
  X,
  Grid2X2,
  List,
  RefreshCw,
  ShieldCheck,
  History,
  Copy,
  KeyRound,
  Database,
  Cloud,
  Activity,
  MoreHorizontal,
  ExternalLink,
  Leaf,
  Code2,
  Layers3,
  Info,
  Archive,
  type LucideIcon,
} from "lucide-react";
import {
  type HubData,
  type Content,
  type ContentDetail,
  type Source,
  type Artifact,
  type Asset,
  type Publication,
} from "@/lib/domain";
import { AgentConsole } from "./agent-console";
import { Editor, blankContent } from "./editor";
import {
  api,
  upload,
  downloadFile,
  Modal,
  Spinner,
  Empty,
  Badge,
  External,
  formatDate,
  sizeLabel,
  type Notice,
} from "./ui";
type View =
  | "agents"
  | "overview"
  | "contents"
  | "sources"
  | "assets"
  | "artifacts"
  | "publications"
  | "settings";
const nav: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "agents", label: "Agent 管理台", icon: ShieldCheck },
  { id: "contents", label: "内容库", icon: Files },
  { id: "sources", label: "信息源", icon: BookOpen },
  { id: "assets", label: "素材库", icon: ImageIcon },
  { id: "artifacts", label: "产物库", icon: PackageCheck },
  { id: "publications", label: "发布记录", icon: Send },
  { id: "settings", label: "连接与设置", icon: Plug },
];
const platformNames: Record<string, string> = {
  wechat: "微信公众号",
  x: "X",
  xiaohongshu: "小红书",
  zhihu: "知乎",
  douyin: "抖音",
  other: "其他平台",
};
const eventNames: Record<string, string> = {
  "content.created": "创建了内容",
  "content.versioned": "保存了新版本",
  "source.saved": "归档了信息来源",
  "source.deduplicated": "复用了来源快照",
  "artifact.frozen": "冻结了派生产物",
  "publication.recorded": "更新了发布记录",
  "asset.saved": "存入了图片素材",
  "auth.login": "登录了工作台",
  "token.created": "创建了连接令牌",
  "token.revoked": "撤销了连接",
  "oauth.approved": "批准了只读授权",
};
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Layers3 size={23} strokeWidth={1.7} />
      </span>
      <span>
        Content Hub<small>内容中枢</small>
      </span>
    </div>
  );
}
function Login({
  configured,
  onLogin,
}: {
  configured: boolean;
  onLogin: () => Promise<void>;
}) {
  const [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("auth/login", "POST", { password });
      setPassword("");
      const target = new URLSearchParams(window.location.search).get(
        "returnTo",
      );
      if (
        target &&
        target.startsWith("/") &&
        !target.startsWith("//") &&
        !/[\\\r\n]/.test(target)
      ) {
        window.location.href = target;
        return;
      }
      await onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <Brand />
        <div className="login-message">
          <div className="eyebrow">A HOME FOR YOUR IDEAS</div>
          <h1>
            让每一次创作，
            <br />
            都有来处，
            <br />
            <em>也有去处。</em>
          </h1>
          <p>
            从一条灵感到一次发布。
            <br />
            把信息、正文和每一次产出，留在属于你的地方。
          </p>
          <div className="login-diagram">
            <span>
              <BookOpen size={17} />
              来源
            </span>
            <ArrowRight size={15} />
            <span className="selected">
              <FileText size={17} />
              内容
            </span>
            <ArrowRight size={15} />
            <span>
              <PackageCheck size={17} />
              产物
            </span>
          </div>
        </div>
        <div className="login-bottom">
          <ShieldCheck size={15} />
          PRIVATE BY DEFAULT<span>属于你的内容，始终属于你。</span>
        </div>
      </section>
      <section className="login-form-area">
        <form onSubmit={submit} className="login-form">
          <span className="login-key">
            <LockKeyhole size={24} />
          </span>
          <div className="eyebrow">YOUR PRIVATE WORKSPACE</div>
          <h2>欢迎回到内容中枢</h2>
          <p>登录你的个人工作区，继续未完成的好想法。</p>
          {configured ? (
            <>
              <label className="field">
                工作区密码
                <input
                  type="password"
                  name="password"
                  aria-label="工作区密码"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="输入初始化时生成的密码"
                />
              </label>
              {error && (
                <div role="alert" className="inline-error">
                  {error}
                </div>
              )}
              <button className="button primary full" disabled={busy}>
                {busy ? (
                  <Spinner />
                ) : (
                  <>
                    进入工作台
                    <ArrowRight size={17} />
                  </>
                )}
              </button>
            </>
          ) : (
            <div className="setup-message">
              <strong>先初始化你的工作区</strong>
              <p>
                在项目目录运行下方命令。它会生成独立的强密码，不存在默认密码或游客入口。
              </p>
              <code>npm run setup</code>
              <p>然后启动应用并刷新本页。</p>
              <button
                type="button"
                className="button secondary full"
                onClick={() => window.location.reload()}
              >
                <RefreshCw size={16} />
                我已初始化，刷新
              </button>
            </div>
          )}
          <div className="login-security">
            <LockKeyhole size={13} />
            单一所有者 · 会话保护 · 内容默认私有
          </div>
        </form>
        <div className="login-copyright">
          少一点分散，多一点沉淀。<span>CONTENT HUB / 01</span>
        </div>
      </section>
    </main>
  );
}
function ContentCard({
  content,
  onOpen,
}: {
  content: Content;
  onOpen: () => void;
}) {
  return (
    <button className="content-card" onClick={onOpen}>
      <div className="card-top">
        <span className="document-icon">
          <FileText size={20} strokeWidth={1.5} />
        </span>
        <Badge value={content.status} />
      </div>
      <h3>{content.title}</h3>
      <p>
        {content.excerpt
          ?.split("\n")
          .slice(1 + content.tags.length)
          .join(" ")
          .trim() || "这篇内容还在酝酿中。"}
      </p>
      <div className="card-tags">
        {content.tags.slice(0, 3).map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <div className="card-footer">
        <span>
          <Link2 size={12} />
          {content.source_count || 0} 个来源
        </span>
        <span>
          v{content.current_version}
          <ArrowUpRight size={14} />
        </span>
      </div>
    </button>
  );
}
function SourceImport({
  onClose,
  onDone,
  notice,
}: {
  onClose: () => void;
  onDone: () => Promise<void>;
  notice: Notice;
}) {
  const [mode, setMode] = useState<"url" | "manual" | "file">("url"),
    [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      if (mode === "url")
        await api("sources/url", "POST", {
          url: form.get("url"),
          include_images: form.get("images") === "on",
        });
      else
        await api("sources", "POST", {
          title: form.get("title"),
          url: form.get("url"),
          markdown: form.get("markdown"),
          trust_level: form.get("trust_level"),
        });
      await onDone();
      notice("信息源已保存，原始快照可随时下载");
      onClose();
    } catch (err) {
      notice((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      await upload("sources/upload", file);
      await onDone();
      notice("文件已归档");
      onClose();
    } catch (e) {
      notice((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="保存一个信息源"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal-body">
        <div className="segmented source-tabs">
          {(["url", "manual", "file"] as const).map((id) => (
            <button
              key={id}
              className={mode === id ? "active" : ""}
              onClick={() => setMode(id)}
              disabled={busy}
            >
              {id === "url"
                ? "链接采集"
                : id === "manual"
                  ? "粘贴原文"
                  : "上传文件"}
            </button>
          ))}
        </div>
        {mode === "file" ? (
          <>
            <input
              type="file"
              ref={fileRef}
              hidden
              accept=".html,.htm,.md,.txt,.pdf"
              onChange={(e) => void importFile(e.target.files?.[0])}
            />
            <button
              className="drop-area"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              {busy ? <Spinner /> : <Upload size={28} />}
              <strong>选择原始文件</strong>
              <span>HTML、Markdown、TXT、PDF · 最大 10 MB</span>
            </button>
            <div className="inline-note">
              PDF 当前只保存原始快照，不自动提取正文。上传 HTML
              不会执行其中的脚本。
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            {mode === "manual" && (
              <label className="field">
                来源标题
                <input
                  name="title"
                  placeholder="这份资料叫什么？"
                  required
                  maxLength={200}
                />
              </label>
            )}
            <label className="field">
              {mode === "url" ? "网页链接" : "原始链接（可选）"}
              <input
                name="url"
                type="url"
                placeholder="https://…"
                required={mode === "url"}
                maxLength={2000}
              />
            </label>
            {mode === "url" ? (
              <>
                <label className="checkbox-label">
                  <input type="checkbox" name="images" />
                  同时存档正文图片（最多 5 张）
                </label>
                <div className="inline-note">
                  只抓取公开可访问的 HTTPS 页面。需要登录、反爬或非 UTF-8
                  页面，建议改用粘贴原文或上传文件。
                </div>
              </>
            ) : (
              <>
                <label className="field">
                  原始正文
                  <textarea
                    name="markdown"
                    aria-label="原始正文"
                    rows={9}
                    required
                    placeholder="粘贴原始文本或 Markdown，保留可核对的证据…"
                    maxLength={500000}
                  />
                </label>
                <label className="field">
                  人工判断的可信度
                  <select name="trust_level" defaultValue="medium">
                    <option value="high">高 · 一手资料 / 官方文档</option>
                    <option value="medium">中 · 尚需交叉验证</option>
                    <option value="low">低 · 线索 / 待证实信息</option>
                  </select>
                </label>
              </>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? <Spinner /> : <BookOpen size={16} />}保存并归档
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}
function SourceDetail({
  source,
  onClose,
  onCreate,
  notice,
}: {
  source: Source;
  onClose: () => void;
  onCreate: () => void;
  notice: Notice;
}) {
  const warnings = Array.isArray(source.meta?.warnings)
    ? (source.meta.warnings as string[])
    : [];
  return (
    <Modal title={source.title} onClose={onClose} wide>
      <div className="modal-body">
        <div className="source-detail-meta">
          <span>
            <ShieldCheck size={14} />
            {source.trust_level === "high"
              ? "高可信"
              : source.trust_level === "low"
                ? "待证实"
                : "需交叉验证"}
          </span>
          <span>{formatDate(source.fetched_at)}</span>
          {source.original_url && (
            <External url={source.original_url}>原始网页</External>
          )}
        </div>
        {warnings.length > 0 && (
          <div className="inline-note">{warnings.join("；")}</div>
        )}
        <pre className="source-text">{source.markdown}</pre>
        <div className="hash-box">
          原始快照 SHA-256
          <br />
          {source.sha256}
        </div>
        <div className="form-actions">
          <button
            className="button secondary"
            onClick={() =>
              void downloadFile("sources/" + source.id + "/snapshot").catch(
                (e) => notice(e.message, true),
              )
            }
          >
            <Download size={16} />
            下载原始快照
          </button>
          <button className="button primary" onClick={onCreate}>
            <Plus size={16} />
            基于此来源创建
          </button>
        </div>
      </div>
    </Modal>
  );
}
function PublicationForm({
  artifacts,
  initial,
  selected,
  onClose,
  onDone,
  notice,
}: {
  artifacts: Artifact[];
  initial: Publication | null;
  selected: string;
  onClose: () => void;
  onDone: () => Promise<void>;
  notice: Notice;
}) {
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(initial?.status || "draft");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api(
        "publications" + (initial ? "/" + initial.id : ""),
        initial ? "PATCH" : "POST",
        {
          artifact_id: initial?.artifact_id || values.get("artifact_id"),
          platform: initial?.platform || values.get("platform"),
          status,
          url: values.get("url"),
          note: values.get("note"),
        },
      );
      await onDone();
      notice("发布记录已保存（未向外部平台发送内容）");
      onClose();
    } catch (err) {
      notice((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={initial ? "更新发布记录" : "登记一次发布"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="modal-body" onSubmit={submit}>
        <div className="inline-note">
          这里只登记你在平台上的操作结果，不会自动发文。没有真实链接时，请保留为草稿或待审核。
        </div>
        <label className="field">
          对应的冻结产物
          <select
            name="artifact_id"
            required
            disabled={!!initial}
            defaultValue={initial?.artifact_id || selected || artifacts[0]?.id}
          >
            {artifacts.map((a) => (
              <option value={a.id} key={a.id}>
                {a.title} · v{a.content_version} · {a.variant}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label className="field">
            平台
            <select
              name="platform"
              disabled={!!initial}
              defaultValue={initial?.platform || "wechat"}
            >
              {Object.entries(platformNames).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            状态
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="draft">草稿</option>
              <option value="submitted">待审核</option>
              <option value="published">已发布（手动确认）</option>
              <option value="rejected">未通过</option>
              <option value="removed">已下架</option>
            </select>
          </label>
        </div>
        <label className="field">
          平台原文链接{status === "published" ? "（必填）" : "（可选）"}
          <input
            name="url"
            type="url"
            required={status === "published"}
            defaultValue={initial?.url || ""}
            placeholder="https://…"
          />
        </label>
        <label className="field">
          备注
          <textarea
            name="note"
            rows={3}
            maxLength={2000}
            defaultValue={initial?.note || ""}
            placeholder="例如：已在公众号后台提交审核。"
          />
        </label>
        <button
          className="button primary full"
          disabled={busy || !artifacts.length}
        >
          {busy ? <Spinner /> : <Check size={16} />}保存记录
        </button>
      </form>
    </Modal>
  );
}
type Connection = {
  id: string;
  label: string;
  kind: string;
  scopes: string[];
  expires_at: string;
  created_at: string;
};
function Settings({ data, notice }: { data: HubData; notice: Notice }) {
  const [tokens, setTokens] = useState<Connection[]>([]),
    [showNew, setShowNew] = useState(false),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => setTokens(await api("tokens")), []);
  useEffect(() => {
    void refresh().catch((e) => notice(e.message, true));
  }, [refresh, notice]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const result = await api<{ token: string }>("tokens", "POST", {
        label: form.get("label"),
        write: form.get("write") === "on",
      });
      setToken(result.token);
      await refresh();
    } catch (e) {
      notice((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (!confirm("撤销后，这个客户端将不能继续访问。确认撤销？")) return;
    try {
      await api("tokens/" + id, "DELETE");
      await refresh();
      notice("连接权限已撤销");
    } catch (e) {
      notice((e as Error).message, true);
    }
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <div className="eyebrow">CONNECTED, NOT EXPOSED</div>
          <h1>连接你的工作流</h1>
          <p>让工具访问内容，让凭证留在服务端。</p>
        </div>
      </div>
      <div className="inline-note">
        新增 Agent 建议使用 <a href="/?view=agents">Agent 管理台</a>{" "}
        分配项目与细分权限。以下为兼容接入，全库令牌不是项目范围令牌。
      </div>
      <div className="settings-grid">
        <section className="panel settings-panel">
          <div className="panel-heading">
            <h2>
              <Plug size={18} />
              MCP 接入
            </h2>
            <span className="badge badge-ready">
              <i />
              只读工具
            </span>
          </div>
          <p className="muted">
            已提供 search、fetch、list_contents。支持 Bearer 令牌与预注册 OAuth
            + PKCE。不同客户端的支持范围以实测为准。
          </p>
          <label className="field">
            远程端点
            <div className="copy-field">
              <input readOnly value={data.system.mcp} />
              <button
                className="icon-button"
                aria-label="复制 MCP 地址"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(data.system.mcp)
                    .then(() => notice("地址已复制"))
                    .catch(() => notice("请手动复制地址", true))
                }
              >
                <Copy size={16} />
              </button>
            </div>
          </label>
          <div className="setting-info">
            <ShieldCheck size={17} />
            <p>
              OAuth 授权必须先登录并手动确认。访问令牌有效期 1
              小时，刷新令牌轮换；没有自动批准或开放注册。
            </p>
          </div>
          <div className="oauth-summary">
            预注册客户端：
            {data.system.oauth_clients.length
              ? data.system.oauth_clients.map((c) => c.name).join("、")
              : "尚未配置"}
            <small>
              在服务器 OAUTH_CLIENTS_JSON 配置精确 client_id 和
              redirect_uris。参考仓库 docs/CONNECTING.md。
            </small>
          </div>
        </section>
        <section className="panel settings-panel">
          <div className="panel-heading">
            <h2>
              <Database size={18} />
              存储与备份
            </h2>
            <ShieldCheck size={17} />
          </div>
          <div className="system-row">
            <span>权威数据库</span>
            <strong>
              {data.system.database === "postgres"
                ? "PostgreSQL"
                : "PGlite · 本地持久化"}
            </strong>
          </div>
          <div className="system-row">
            <span>私有文件存储</span>
            <strong>
              {data.system.storage === "s3"
                ? "S3 兼容对象存储"
                : "本地内容寻址存储"}
            </strong>
          </div>
          <div className="system-row">
            <span>产物与审计历史</span>
            <strong>数据库级不可修改</strong>
          </div>
          <p className="muted">
            备份包含内容、来源快照、素材和发布历史，不包含密码、会话和连接令牌。网页备份上限
            50 MB。
          </p>
          <button
            className="button secondary full"
            onClick={() => {
              setBusy(true);
              void downloadFile("backup")
                .then(() => notice("备份已下载，请妥善保管"))
                .catch((e) => notice(e.message, true))
                .finally(() => setBusy(false));
            }}
            disabled={busy}
          >
            {busy ? <Spinner /> : <Download size={16} />}下载完整内容备份
          </button>
          <p className="fine-print">
            恢复只允许写入空数据库，命令：npm run restore -- backup.json
          </p>
        </section>
        <section className="panel settings-panel connections-panel">
          <div className="panel-heading">
            <h2>
              <KeyRound size={18} />
              已授权连接
            </h2>
            <button
              className="button secondary compact"
              onClick={() => {
                setToken("");
                setShowNew(true);
              }}
            >
              <Plus size={15} />
              新建令牌
            </button>
          </div>
          {tokens.length ? (
            <div className="connection-list">
              {tokens.map((item) => (
                <div className="connection-row" key={item.id}>
                  <span className="connection-icon">
                    <Plug size={18} />
                  </span>
                  <div>
                    <strong>{item.label}</strong>
                    <small>
                      {item.kind === "api"
                        ? "手动令牌"
                        : item.kind === "access"
                          ? "OAuth 访问令牌"
                          : "OAuth 刷新令牌"}{" "}
                      ·{" "}
                      {item.scopes.includes("content:write")
                        ? "允许写入"
                        : "只读"}{" "}
                      · 到期 {formatDate(item.expires_at)}
                    </small>
                  </div>
                  <button
                    className="text-button danger"
                    onClick={() => void revoke(item.id)}
                  >
                    撤销
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="还没有授权任何工具"
              description="为每个客户端单独创建令牌，便于区分访问来源和独立撤销。"
            />
          )}
        </section>
        <section className="panel settings-panel integration-boundaries">
          <div className="panel-heading">
            <h2>
              <Send size={18} />
              外部分发边界
            </h2>
          </div>
          <p>当前可生成并下载内容产物，再手动登记发布结果。</p>
          <div className="integration-line">
            <span>公众号 / 小红书 / 知乎 / X</span>
            <span className="subtle-badge">手动发布</span>
          </div>
          <div className="integration-line">
            <span>现有凭证服务器</span>
            <span className="subtle-badge">待提供 API 合同</span>
          </div>
          <div className="integration-line">
            <span>飞书目录同步</span>
            <span className="subtle-badge">未接入</span>
          </div>
          <div className="integration-line">
            <span>图片 / 视频模型</span>
            <span className="subtle-badge">导出提示词与分镜</span>
          </div>
          <p className="fine-print">
            这些能力不会显示为“已连接”，也不会读取或暴露第三方平台密钥。
          </p>
        </section>
      </div>
      {showNew && (
        <Modal
          title={token ? "保存你的连接令牌" : "为客户端创建令牌"}
          onClose={() => {
            if (!busy) {
              setShowNew(false);
              setToken("");
            }
          }}
        >
          {token ? (
            <div className="modal-body">
              <div className="inline-note">
                令牌只在本次显示，服务端仅保存摘要。请放入客户端的安全配置，不要贴到文章或公开仓库。
              </div>
              <textarea
                className="token-value"
                readOnly
                value={token}
                rows={3}
                aria-label="新令牌"
              />
              <button
                className="button primary full"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(token)
                    .then(() => notice("令牌已复制"))
                    .catch(() => notice("请手动复制令牌", true))
                }
              >
                <Copy size={16} />
                复制令牌
              </button>
              <p className="fine-print">
                有效期 90 天。MCP 工具始终只读；可写令牌只对 REST API
                的内容操作生效。
              </p>
            </div>
          ) : (
            <form className="modal-body" onSubmit={create}>
              <label className="field">
                连接名称
                <input
                  name="label"
                  required
                  maxLength={60}
                  placeholder="例如：我的工作 Agent"
                />
              </label>
              <label className="checkbox-label">
                <input type="checkbox" name="write" />
                允许通过 REST API 写入内容
              </label>
              <p className="fine-print">
                默认只读。令牌无法管理其他令牌、授权新客户端或导出完整备份。
              </p>
              <button className="button primary full" disabled={busy}>
                {busy ? <Spinner /> : <KeyRound size={16} />}创建令牌
              </button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
export function Workspace() {
  const [editorSession, setEditorSession] = useState(0);
  const [auth, setAuth] = useState<{
      configured: boolean;
      authenticated: boolean;
    } | null>(null),
    [data, setData] = useState<HubData | null>(null),
    [view, setView] = useState<View>("overview"),
    [editing, setEditing] = useState<ContentDetail | null>(null),
    [dirty, setDirty] = useState(false),
    [fatal, setFatal] = useState(""),
    [navOpen, setNavOpen] = useState(false),
    [toast, setToast] = useState<{
      text: string;
      error: boolean;
      id: number;
    } | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false),
    [sourceDetail, setSourceDetail] = useState<Source | null>(null),
    [publicationOpen, setPublicationOpen] = useState(false),
    [publication, setPublication] = useState<Publication | null>(null),
    [selectedArtifact, setSelectedArtifact] = useState(""),
    [preview, setPreview] = useState<{
      body: string;
      mime: string;
      title: string;
    } | null>(null),
    [assetPreview, setAssetPreview] = useState<Asset | null>(null);
  const [statusFilter, setStatusFilter] = useState("all"),
    [layout, setLayout] = useState<"grid" | "list">("grid"),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [results, setResults] = useState<
      { id: string; type: string; title: string; excerpt: string }[]
    >([]),
    [searchBusy, setSearchBusy] = useState(false);
  const assetInput = useRef<HTMLInputElement>(null);
  const notice = useCallback<Notice>(
    (text, error = false) => setToast({ text, error, id: Date.now() }),
    [],
  );
  const refresh = useCallback(
    async () => setData(await api<HubData>("hub")),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    if (toast.error) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    void (async () => {
      try {
        const status = await api<{
          configured: boolean;
          authenticated: boolean;
        }>("auth/status");
        setAuth(status);
        if (status.authenticated) {
          await refresh();
          const params = new URLSearchParams(window.location.search);
          const target = params.get("view");
          if (nav.some((n) => n.id === target)) setView(target as View);
          if (params.get("content")) {
            setEditing(
              await api<ContentDetail>(
                "contents/" + encodeURIComponent(params.get("content")!),
              ),
            );
            setView("contents");
          }
          if (params.get("source"))
            setSourceDetail(
              await api<Source>(
                "sources/" + encodeURIComponent(params.get("source")!),
              ),
            );
        }
      } catch (e) {
        setFatal((e as Error).message);
      }
    })();
  }, [refresh]);
  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      setSearchBusy(false);
      return;
    }
    let cancelled = false;
    setSearchBusy(true);
    const timer = setTimeout(() => {
      void api<typeof results>("search?q=" + encodeURIComponent(search.trim()))
        .then((r) => {
          if (!cancelled) setResults(r);
        })
        .catch((e) => {
          if (!cancelled) notice(e.message, true);
        })
        .finally(() => {
          if (!cancelled) setSearchBusy(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, notice]);
  function canLeave() {
    return (
      !dirty || confirm("当前内容还有未保存的修改。确认离开并放弃这些修改？")
    );
  }
  function navigate(next: View) {
    if (!canLeave()) return;
    setEditing(null);
    setDirty(false);
    setView(next);
    setNavOpen(false);
    window.history.replaceState(
      {},
      "",
      next === "overview" ? "/" : "/?view=" + next,
    );
  }
  async function openContent(id: string) {
    if (!canLeave()) return;
    try {
      setEditing(await api<ContentDetail>("contents/" + id));
      setEditorSession((n) => n + 1);
      setDirty(false);
      setView("contents");
      setSearch("");
      window.history.replaceState({}, "", "/?content=" + id);
    } catch (e) {
      notice((e as Error).message, true);
    }
  }
  function createContent(source?: Source) {
    if (!canLeave()) return;
    setEditing(blankContent(source));
    setEditorSession((n) => n + 1);
    setDirty(false);
    setView("contents");
    setSourceDetail(null);
    setNavOpen(false);
  }
  async function openSource(id: string) {
    try {
      setSourceDetail(await api<Source>("sources/" + id));
      setSearch("");
    } catch (e) {
      notice((e as Error).message, true);
    }
  }
  async function demo() {
    setBusy(true);
    try {
      await api("demo", "POST", {});
      await refresh();
      notice("已导入 3 篇明确标记的示例，没有向外发布任何内容");
    } catch (e) {
      notice((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function uploadAssets(files: FileList | File[] | null) {
    if (!files) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await upload("assets", file);
      }
      await refresh();
      notice("图片已重编码、去重并安全入库");
    } catch (e) {
      notice((e as Error).message, true);
    } finally {
      setBusy(false);
      if (assetInput.current) assetInput.current.value = "";
    }
  }
  async function more(
    collection:
      | "contents"
      | "sources"
      | "assets"
      | "artifacts"
      | "publications",
  ) {
    if (!data) return;
    setBusy(true);
    try {
      const rows = await api<
        (Content | Source | Asset | Artifact | Publication)[]
      >(`${collection}?offset=${data[collection].length}`);
      if (!rows.length) {
        notice("已经加载全部记录");
        return;
      }
      setData((d) =>
        d
          ? {
              ...d,
              [collection]: Array.from(
                new Map(
                  [...d[collection], ...rows].map((r) => [r.id, r]),
                ).values(),
              ),
            }
          : d,
      );
    } catch (e) {
      notice((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function showArtifact(artifact: Artifact) {
    try {
      const p = await api<{ body: string; mime: string }>(
        "artifacts/" + artifact.id + "/preview",
      );
      setPreview({ ...p, title: artifact.title });
    } catch (e) {
      notice((e as Error).message, true);
    }
  }
  async function logout() {
    if (!canLeave()) return;
    try {
      await api("auth/logout", "POST", {});
      setAuth((a) => ({ ...a!, authenticated: false }));
      setData(null);
      setEditing(null);
    } catch (e) {
      notice((e as Error).message, true);
    }
  }
  if (fatal)
    return (
      <main className="fatal">
        <LockKeyhole size={36} />
        <h1>暂时无法打开工作台</h1>
        <p>{fatal}</p>
        <button
          className="button primary"
          onClick={() => window.location.reload()}
        >
          重新连接
        </button>
      </main>
    );
  if (!auth)
    return (
      <div className="app-loading">
        <Brand />
        <Spinner />
        <p>正在打开你的工作区…</p>
      </div>
    );
  if (!auth.authenticated)
    return (
      <Login
        configured={auth.configured}
        onLogin={async () => {
          await refresh();
          setAuth({ configured: true, authenticated: true });
        }}
      />
    );
  if (!data)
    return (
      <div className="app-loading">
        <Spinner />
        <p>正在读取内容仓库…</p>
      </div>
    );
  const filtered = data.contents.filter(
    (c) => statusFilter === "all" || c.status === statusFilter,
  );
  const currentLabel = nav.find((n) => n.id === view)!.label;
  const stats = [
    {
      label: "内容资产",
      value: data.counts.contents,
      icon: FileText,
      note: "每个想法，都值得留下",
      target: "contents" as View,
    },
    {
      label: "已归档来源",
      value: data.counts.sources,
      icon: BookOpen,
      note: "观点有依据，引用可追溯",
      target: "sources" as View,
    },
    {
      label: "冻结产物",
      value: data.counts.artifacts,
      icon: PackageCheck,
      note: "保留真正输出的那一份",
      target: "artifacts" as View,
    },
    {
      label: "已发布记录",
      value: data.counts.published,
      icon: Send,
      note: "根据平台链接手动确认",
      target: "publications" as View,
    },
  ];
  return (
    <div className={"app-shell " + (navOpen ? "nav-open" : "")}>
      <aside className="sidebar">
        <Brand />
        <button className="workspace-switch">
          <span className="avatar">K</span>
          <span>
            我的创作空间<small>个人工作区</small>
          </span>
          <LockKeyhole size={14} />
        </button>
        <div className="nav-caption">工作台 / WORKSPACE</div>
        <nav aria-label="主导航">
          {nav.map((item, index) => (
            <div
              key={item.id}
              className={item.id === "settings" ? "nav-divider" : ""}
            >
              <button
                className={view === item.id ? "active" : ""}
                onClick={() => navigate(item.id)}
                aria-current={view === item.id ? "page" : undefined}
              >
                <item.icon size={18} strokeWidth={1.7} />
                <span>{item.label}</span>
                {item.id === "contents" && data.counts.contents > 0 && (
                  <small>{data.counts.contents}</small>
                )}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <ShieldCheck size={16} />
            <div>
              内容默认私有<small>只有你授权的工具能访问</small>
            </div>
          </div>
          <button
            className="owner-profile"
            onClick={() => void logout()}
            title="退出登录"
          >
            <span className="avatar small-avatar">K</span>
            <span>
              工作区所有者<small>已安全登录</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      {navOpen && (
        <button
          className="nav-backdrop"
          aria-label="关闭导航"
          onClick={() => setNavOpen(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="打开导航"
            onClick={() => setNavOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            <span>个人工作区</span>
            <ChevronRight size={13} />
            <strong>{editing ? "内容编辑" : currentLabel}</strong>
          </div>
          <div className="global-search">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索内容和信息源…"
              aria-label="全局搜索"
              maxLength={200}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSearch("");
              }}
            />
            {search ? (
              <button
                className="icon-button small"
                onClick={() => setSearch("")}
                aria-label="清空搜索"
              >
                <X size={13} />
              </button>
            ) : (
              <kbd>⌕</kbd>
            )}
            {search && (
              <div className="search-results">
                {searchBusy ? (
                  <div className="search-placeholder">
                    <Spinner />
                    搜索仓库中…
                  </div>
                ) : results.length ? (
                  results.map((r) => (
                    <button
                      key={r.type + r.id}
                      onClick={() =>
                        void (r.type === "content"
                          ? openContent(r.id)
                          : openSource(r.id))
                      }
                    >
                      {r.type === "content" ? (
                        <FileText size={17} />
                      ) : (
                        <BookOpen size={17} />
                      )}
                      <span>
                        <strong>{r.title}</strong>
                        <small>
                          {r.type === "content" ? "内容" : "来源"} ·{" "}
                          {r.excerpt.slice(0, 70)}
                        </small>
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))
                ) : (
                  <div className="search-placeholder">
                    没有匹配的内容或信息源
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            className="icon-button refresh-button"
            aria-label="刷新数据"
            onClick={() =>
              void refresh()
                .then(() => notice("数据已刷新"))
                .catch((e) => notice(e.message, true))
            }
          >
            <RefreshCw size={16} />
          </button>
          <span className="header-divider" />
          <span className="avatar top-avatar">K</span>
        </header>
        <main className={"main-content " + (editing ? "with-editor" : "")}>
          {editing ? (
            <Editor
              key={editorSession}
              initial={editing}
              sources={data.sources}
              assets={data.assets}
              onBack={() => navigate("contents")}
              onSaved={setEditing}
              onRefresh={refresh}
              notice={notice}
              onDirty={setDirty}
            />
          ) : (
            <>
              {view === "overview" && (
                <>
                  <div className="overview-heading">
                    <div>
                      <div className="eyebrow">MAKE ROOM FOR GOOD IDEAS</div>
                      <h1>
                        好内容，从这里发生<span>。</span>
                      </h1>
                      <p>收集值得记住的信息，把想法变成长期资产。</p>
                    </div>
                    <div className="heading-actions">
                      <button
                        className="button secondary"
                        onClick={() => setSourceOpen(true)}
                      >
                        <Link2 size={16} />
                        保存来源
                      </button>
                      <button
                        className="button primary"
                        onClick={() => createContent()}
                      >
                        <Plus size={17} />
                        新建内容
                      </button>
                    </div>
                  </div>
                  <div className="stats-grid">
                    {stats.map((item) => (
                      <button
                        className="stat-card"
                        key={item.label}
                        onClick={() => navigate(item.target)}
                      >
                        <div>
                          <span>{item.label}</span>
                          <item.icon size={18} strokeWidth={1.5} />
                        </div>
                        <strong>
                          {item.value.toString().padStart(2, "0")}
                        </strong>
                        <small>
                          {item.note}
                          <ArrowUpRight size={13} />
                        </small>
                      </button>
                    ))}
                  </div>
                  <div className="dashboard-columns">
                    <section className="dashboard-left">
                      <div className="section-bar">
                        <h2>
                          最近的创作<span>RECENT STORIES</span>
                        </h2>
                        <button
                          className="text-button"
                          onClick={() => navigate("contents")}
                        >
                          全部内容
                          <ArrowRight size={15} />
                        </button>
                      </div>
                      {data.contents.length ? (
                        <div className="content-grid overview-grid">
                          {data.contents.slice(0, 4).map((c) => (
                            <ContentCard
                              key={c.id}
                              content={c}
                              onOpen={() => void openContent(c.id)}
                            />
                          ))}
                        </div>
                      ) : (
                        <section className="panel">
                          <Empty
                            title="从第一个想法开始"
                            description="创建一篇内容，或导入示例了解如何关联来源、留存版本和生成产物。"
                            action={
                              <div className="empty-actions">
                                <button
                                  className="button primary"
                                  onClick={() => createContent()}
                                >
                                  <Plus size={16} />
                                  创建第一篇内容
                                </button>
                                <button
                                  className="button secondary"
                                  disabled={busy}
                                  onClick={() => void demo()}
                                >
                                  {busy ? <Spinner /> : <Layers3 size={16} />}
                                  导入示例
                                </button>
                              </div>
                            }
                          />
                        </section>
                      )}
                      <section className="capture-banner">
                        <span className="capture-icon">
                          <BookOpen size={29} strokeWidth={1.3} />
                        </span>
                        <div>
                          <h3>遇到值得留下的好资料？</h3>
                          <p>保存链接背后的原文，而不只是一个书签。</p>
                        </div>
                        <button
                          className="button secondary"
                          onClick={() => setSourceOpen(true)}
                        >
                          收进信息源
                          <ArrowUpRight size={15} />
                        </button>
                      </section>
                      <div className="section-bar">
                        <h2>
                          最近的来源<span>YOUR REFERENCE DESK</span>
                        </h2>
                        <button
                          className="text-button"
                          onClick={() => navigate("sources")}
                        >
                          查看全部
                          <ArrowRight size={15} />
                        </button>
                      </div>
                      <section className="panel source-mini-list">
                        {data.sources.length ? (
                          data.sources.slice(0, 4).map((s) => (
                            <button
                              key={s.id}
                              onClick={() => void openSource(s.id)}
                            >
                              <span className="source-initial">
                                {s.original_url ? (
                                  new URL(
                                    s.original_url,
                                  ).hostname[0].toUpperCase()
                                ) : (
                                  <FileText size={16} />
                                )}
                              </span>
                              <span>
                                <strong>{s.title}</strong>
                                <small>
                                  {s.original_url
                                    ? new URL(s.original_url).hostname
                                    : "手工 / 文件存档"}{" "}
                                  · {formatDate(s.fetched_at)}
                                </small>
                              </span>
                              <span className="subtle-badge">快照已存</span>
                              <ArrowUpRight size={15} />
                            </button>
                          ))
                        ) : (
                          <div className="quiet-empty">
                            尚未保存来源。先收集，再创作。
                          </div>
                        )}
                      </section>
                    </section>
                    <aside className="dashboard-right">
                      <section className="panel flow-panel">
                        <div className="panel-heading">
                          <h2>一条完整的创作路径</h2>
                          <span className="tiny-label">WORKFLOW</span>
                        </div>
                        <p>
                          一份内容，多种表达。
                          <br />
                          每一步，都有迹可循。
                        </p>
                        <div className="flow-steps">
                          {[
                            {
                              n: "01",
                              label: "收集来源",
                              desc: "留存原文与快照",
                              icon: BookOpen,
                              target: "sources" as View,
                            },
                            {
                              n: "02",
                              label: "组织内容",
                              desc: "结构化正文，持续迭代",
                              icon: FileText,
                              target: "contents" as View,
                            },
                            {
                              n: "03",
                              label: "生成产物",
                              desc: "HTML / Markdown / 分镜",
                              icon: PackageCheck,
                              target: "artifacts" as View,
                            },
                            {
                              n: "04",
                              label: "记录发布",
                              desc: "连接平台链接与产物",
                              icon: Send,
                              target: "publications" as View,
                            },
                          ].map((step) => (
                            <button
                              key={step.n}
                              onClick={() => navigate(step.target)}
                            >
                              <span className="step-icon">
                                <step.icon size={17} />
                              </span>
                              <span>
                                <strong>{step.label}</strong>
                                <small>{step.desc}</small>
                              </span>
                              <span className="step-number">{step.n}</span>
                            </button>
                          ))}
                        </div>
                        <div className="flow-footer">
                          <LockKeyhole size={13} />
                          凭证不外流，历史不覆盖。
                        </div>
                      </section>
                      <section className="panel activity-panel">
                        <div className="panel-heading">
                          <h2>工作区动态</h2>
                          <Activity size={16} />
                        </div>
                        <div className="activity-list">
                          {data.events.slice(0, 6).map((e) => (
                            <div key={e.id}>
                              <span className="activity-dot" />
                              <div>
                                <strong>{eventNames[e.type] || e.type}</strong>
                                <p>
                                  {typeof e.payload.title === "string"
                                    ? e.payload.title
                                    : e.actor === "owner"
                                      ? "工作区所有者"
                                      : e.actor}
                                </p>
                                <time>{formatDate(e.created_at)}</time>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                      <div className="quiet-quote">
                        <Leaf size={20} strokeWidth={1.3} />
                        <p>
                          创作不必每次从零开始。
                          <br />
                          让今天的积累，成为明天的底气。
                        </p>
                      </div>
                    </aside>
                  </div>
                </>
              )}
              {view === "contents" && (
                <>
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">A LIBRARY OF YOUR THINKING</div>
                      <h1>内容库</h1>
                      <p>让观点持续生长，让每一次修改都有迹可循。</p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => createContent()}
                    >
                      <Plus size={17} />
                      新建内容
                    </button>
                  </div>
                  <div className="collection-toolbar">
                    <div className="filter-tabs">
                      {[
                        ["all", "全部"],
                        ["draft", "草稿"],
                        ["ready", "待分发"],
                        ["archived", "已归档"],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          className={statusFilter === id ? "active" : ""}
                          onClick={() => setStatusFilter(id)}
                        >
                          {label}
                          <span>
                            {
                              data.contents.filter(
                                (c) => id === "all" || c.status === id,
                              ).length
                            }
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="segmented view-switch">
                      <button
                        className={layout === "grid" ? "active" : ""}
                        onClick={() => setLayout("grid")}
                        aria-label="卡片视图"
                      >
                        <Grid2X2 size={16} />
                      </button>
                      <button
                        className={layout === "list" ? "active" : ""}
                        onClick={() => setLayout("list")}
                        aria-label="列表视图"
                      >
                        <List size={17} />
                      </button>
                    </div>
                  </div>
                  {filtered.length ? (
                    layout === "grid" ? (
                      <div className="content-grid">
                        {filtered.map((c) => (
                          <ContentCard
                            key={c.id}
                            content={c}
                            onOpen={() => void openContent(c.id)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="panel table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>内容</th>
                              <th>状态</th>
                              <th>版本</th>
                              <th>最后更新</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {filtered.map((c) => (
                              <tr key={c.id}>
                                <td>
                                  <button
                                    className="table-title"
                                    onClick={() => void openContent(c.id)}
                                  >
                                    <FileText size={17} />
                                    {c.title}
                                  </button>
                                </td>
                                <td>
                                  <Badge value={c.status} />
                                </td>
                                <td className="mono">v{c.current_version}</td>
                                <td>{formatDate(c.updated_at)}</td>
                                <td>
                                  <button
                                    className="icon-button"
                                    onClick={() => void openContent(c.id)}
                                    aria-label={"编辑 " + c.title}
                                  >
                                    <ArrowUpRight size={16} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : (
                    <section className="panel">
                      <Empty
                        title={
                          statusFilter === "all"
                            ? "还没有内容"
                            : "这个状态下还没有内容"
                        }
                        description="从一篇新文章开始，或先导入示例熟悉工作流。"
                        action={
                          <div className="empty-actions">
                            <button
                              className="button primary"
                              onClick={() => createContent()}
                            >
                              <Plus size={15} />
                              新建内容
                            </button>
                            {!data.contents.length && (
                              <button
                                className="button secondary"
                                onClick={() => void demo()}
                                disabled={busy}
                              >
                                导入示例
                              </button>
                            )}
                          </div>
                        }
                      />
                    </section>
                  )}
                  {data.contents.length >= 100 && (
                    <button
                      className="load-more"
                      onClick={() => void more("contents")}
                      disabled={busy}
                    >
                      加载更多内容
                    </button>
                  )}
                  <div className="collection-footnote">
                    <ShieldCheck size={13} />
                    正文版本只追加，归档不会删除历史或产物。
                  </div>
                </>
              )}
              {view === "sources" && (
                <>
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">
                        KEEP THE ORIGINAL, NOT JUST THE LINK
                      </div>
                      <h1>信息源</h1>
                      <p>给每个论断，保留一条来时的路。</p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => setSourceOpen(true)}
                    >
                      <Plus size={17} />
                      保存来源
                    </button>
                  </div>
                  <div className="info-strip">
                    <ShieldCheck size={18} />
                    <span>
                      原始字节快照 + 可检索文本 +
                      正文引用。即使链接失效，资料依然在这里。
                    </span>
                    <span className="tiny-label">TRACEABLE BY DESIGN</span>
                  </div>
                  {data.sources.length ? (
                    <div className="source-grid">
                      {data.sources.map((s) => (
                        <button
                          className="source-card panel"
                          onClick={() => void openSource(s.id)}
                          key={s.id}
                        >
                          <div className="source-card-top">
                            <span className="source-initial">
                              {s.original_url ? (
                                new URL(
                                  s.original_url,
                                ).hostname[0].toUpperCase()
                              ) : (
                                <FileText size={18} />
                              )}
                            </span>
                            <span>
                              {s.original_url
                                ? new URL(s.original_url).hostname
                                : "本地归档"}
                            </span>
                            <ArrowUpRight size={17} />
                          </div>
                          <h3>{s.title}</h3>
                          <p>{s.markdown.slice(0, 140)}</p>
                          <div className="source-card-footer">
                            <span className={"trust trust-" + s.trust_level}>
                              <i />
                              {s.trust_level === "high"
                                ? "高可信"
                                : s.trust_level === "low"
                                  ? "待证实"
                                  : "需验证"}
                            </span>
                            <span>{formatDate(s.fetched_at)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <section className="panel">
                      <Empty
                        title="让资料不再散落各处"
                        description="保存公开网页、粘贴原文，或上传 HTML、Markdown、TXT 和 PDF 快照。"
                        action={
                          <button
                            className="button primary"
                            onClick={() => setSourceOpen(true)}
                          >
                            <Link2 size={16} />
                            保存第一个来源
                          </button>
                        }
                      />
                    </section>
                  )}
                  {data.sources.length >= 100 && (
                    <button
                      className="load-more"
                      onClick={() => void more("sources")}
                      disabled={busy}
                    >
                      加载更多来源
                    </button>
                  )}
                </>
              )}
              {view === "assets" && (
                <>
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">A PLACE FOR EVERY VISUAL</div>
                      <h1>素材库</h1>
                      <p>一次上传，多次复用。图片不再依赖临时图床。</p>
                    </div>
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => assetInput.current?.click()}
                    >
                      {busy ? <Spinner /> : <Upload size={17} />}上传图片
                    </button>
                  </div>
                  <input
                    ref={assetInput}
                    hidden
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => void uploadAssets(e.target.files)}
                  />
                  <button
                    className="drop-zone"
                    disabled={busy}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!busy) void uploadAssets(e.dataTransfer.files);
                    }}
                    onClick={() => assetInput.current?.click()}
                  >
                    <Upload size={24} strokeWidth={1.5} />
                    <span>
                      <strong>把图片拖到这里，或点击上传</strong>
                      <small>
                        JPEG / PNG / WebP · 单张最大 10 MB ·
                        自动去除元数据并转为 WebP
                      </small>
                    </span>
                    <span className="subtle-badge">私有存储</span>
                  </button>
                  {data.assets.length ? (
                    <div className="asset-grid">
                      {data.assets.map((a) => (
                        <button
                          className="asset-card panel"
                          key={a.id}
                          onClick={() => setAssetPreview(a)}
                        >
                          <div>
                            <img
                              src={"/api/assets/" + a.id}
                              alt={a.name}
                              loading="lazy"
                            />
                          </div>
                          <section>
                            <h3>{a.name}</h3>
                            <p>
                              {a.width} × {a.height}
                              <span>{sizeLabel(a.bytes)}</span>
                            </p>
                          </section>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="给你的内容准备一些画面"
                      description="这里保存的是实际图片文件。配图提示词可在内容编辑器中编写和导出。"
                    />
                  )}
                  {data.assets.length >= 100 && (
                    <button
                      className="load-more"
                      onClick={() => void more("assets")}
                      disabled={busy}
                    >
                      加载更多素材
                    </button>
                  )}
                </>
              )}
              {view === "artifacts" && (
                <>
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">EXACTLY WHAT YOU CREATED</div>
                      <h1>产物库</h1>
                      <p>每一份输出，都是某个内容版本的永久快照。</p>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => navigate("contents")}
                    >
                      从内容生成
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  <div className="info-strip">
                    <LockKeyhole size={18} />
                    <span>
                      产物只新增、不覆盖。正文更新后，旧产物会标记为“历史版本”，但始终可以下载。
                    </span>
                  </div>
                  {data.artifacts.length ? (
                    <div className="artifact-list">
                      {data.artifacts.map((a) => (
                        <article className="artifact-card panel" key={a.id}>
                          <span className={"artifact-icon format-" + a.kind}>
                            {a.kind === "html" ? (
                              <Code2 size={25} />
                            ) : a.kind === "markdown" ? (
                              <FileText size={25} />
                            ) : (
                              <Layers3 size={25} />
                            )}
                            <small>{a.kind.toUpperCase()}</small>
                          </span>
                          <div className="artifact-info">
                            <div className="artifact-title">
                              <h3>{a.title}</h3>
                              {a.stale && (
                                <span className="historical">
                                  正文已有新版本
                                </span>
                              )}
                            </div>
                            <p>
                              v{a.content_version} · {a.variant} ·{" "}
                              {sizeLabel(a.bytes)} · {formatDate(a.created_at)}
                            </p>
                            <code>SHA-256 {a.sha256.slice(0, 24)}…</code>
                          </div>
                          <div className="artifact-actions">
                            <button
                              className="icon-button"
                              onClick={() => void showArtifact(a)}
                              aria-label={"预览 " + a.title}
                            >
                              <BookOpen size={17} />
                            </button>
                            <button
                              className="button secondary compact"
                              onClick={() =>
                                void downloadFile(
                                  "artifacts/" + a.id + "/download",
                                ).catch((e) => notice(e.message, true))
                              }
                            >
                              <Download size={15} />
                              下载
                            </button>
                            <button
                              className="button primary compact"
                              onClick={() => {
                                setPublication(null);
                                setSelectedArtifact(a.id);
                                setPublicationOpen(true);
                              }}
                            >
                              记录发布
                              <ArrowUpRight size={14} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <section className="panel">
                      <Empty
                        title="先完成一篇内容，再冻结它的输出"
                        description="打开内容编辑器，保存正文后选择“生成产物”。可导出 HTML、Markdown、配图提示词或视频分镜。"
                        action={
                          <button
                            className="button primary"
                            onClick={() => navigate("contents")}
                          >
                            前往内容库
                            <ArrowRight size={16} />
                          </button>
                        }
                      />
                    </section>
                  )}
                  {data.artifacts.length >= 100 && (
                    <button
                      className="load-more"
                      onClick={() => void more("artifacts")}
                      disabled={busy}
                    >
                      加载更多产物
                    </button>
                  )}
                </>
              )}
              {view === "publications" && (
                <>
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">CLOSE THE LOOP</div>
                      <h1>发布记录</h1>
                      <p>记住发了什么、发到哪里，以及对应的那一份产物。</p>
                    </div>
                    <button
                      className="button primary"
                      disabled={!data.artifacts.length}
                      onClick={() => {
                        setPublication(null);
                        setSelectedArtifact("");
                        setPublicationOpen(true);
                      }}
                    >
                      <Plus size={17} />
                      登记发布
                    </button>
                  </div>
                  <div className="info-strip neutral">
                    <Info size={18} />
                    <span>
                      当前是手动发布台账，不会自动向外部平台发文。已发布状态需要你填写真实的平台链接。
                    </span>
                  </div>
                  {data.publications.length ? (
                    <div className="panel table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>内容 / 平台</th>
                            <th>发布状态</th>
                            <th>平台链接</th>
                            <th>更新时间</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {data.publications.map((p) => (
                            <tr key={p.id}>
                              <td>
                                <strong className="publication-title">
                                  {p.title}
                                </strong>
                                <small className="table-sub">
                                  {platformNames[p.platform]} · 手动登记
                                </small>
                              </td>
                              <td>
                                <Badge value={p.status} />
                              </td>
                              <td>
                                {p.url ? (
                                  <External url={p.url}>查看原文</External>
                                ) : (
                                  <span className="muted">尚未填写</span>
                                )}
                              </td>
                              <td>{formatDate(p.updated_at)}</td>
                              <td>
                                <button
                                  className="button secondary compact"
                                  onClick={() => {
                                    setPublication(p);
                                    setSelectedArtifact(p.artifact_id);
                                    setPublicationOpen(true);
                                  }}
                                >
                                  更新记录
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <section className="panel">
                      <Empty
                        title="让每一次发布都可回溯"
                        description="在产物库选择已冻结的文件，发布到平台后，回来登记链接与状态。"
                        action={
                          <button
                            className="button secondary"
                            onClick={() => navigate("artifacts")}
                          >
                            查看可用产物
                            <ArrowRight size={16} />
                          </button>
                        }
                      />
                    </section>
                  )}
                  {data.publications.length >= 100 && (
                    <button
                      className="load-more"
                      onClick={() => void more("publications")}
                      disabled={busy}
                    >
                      加载更多记录
                    </button>
                  )}
                </>
              )}
              {view === "agents" && <AgentConsole notice={notice} />}
              {view === "settings" && <Settings data={data} notice={notice} />}
            </>
          )}
          <footer className="workspace-footer">
            <span>
              <span className="status-dot" />
              私有工作区 · 持久化存储
            </span>
            <span>
              Content Hub<span className="footer-slash">/</span>让内容成为资产
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div
          className={"toast " + (toast.error ? "toast-error" : "")}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <Info size={18} /> : <Check size={18} />}
          <span>{toast.text}</span>
          <button
            className="icon-button small"
            aria-label="关闭提示"
            onClick={() => setToast(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {sourceOpen && (
        <SourceImport
          onClose={() => setSourceOpen(false)}
          onDone={refresh}
          notice={notice}
        />
      )}
      {sourceDetail && (
        <SourceDetail
          source={sourceDetail}
          onClose={() => setSourceDetail(null)}
          onCreate={() => createContent(sourceDetail)}
          notice={notice}
        />
      )}
      {publicationOpen && (
        <PublicationForm
          artifacts={data.artifacts}
          initial={publication}
          selected={selectedArtifact}
          onClose={() => setPublicationOpen(false)}
          onDone={refresh}
          notice={notice}
        />
      )}
      {preview && (
        <Modal
          title={preview.title + " · 产物预览"}
          onClose={() => setPreview(null)}
          wide
        >
          <div className="artifact-preview">
            {preview.mime.startsWith("text/html") ? (
              <iframe title="安全产物预览" sandbox="" srcDoc={preview.body} />
            ) : (
              <pre>{preview.body}</pre>
            )}
          </div>
        </Modal>
      )}
      {assetPreview && (
        <Modal
          title={assetPreview.name}
          onClose={() => setAssetPreview(null)}
          wide
        >
          <div className="modal-body">
            <div className="asset-lightbox">
              <img
                src={"/api/assets/" + assetPreview.id}
                alt={assetPreview.name}
              />
            </div>
            <div className="source-detail-meta">
              <span>
                {assetPreview.width} × {assetPreview.height}
              </span>
              <span>{sizeLabel(assetPreview.bytes)}</span>
              <span>{assetPreview.mime}</span>
            </div>
            <div className="hash-box">
              SHA-256
              <br />
              {assetPreview.sha256}
            </div>
            <button
              className="button secondary"
              onClick={() =>
                void downloadFile(
                  "assets/" + assetPreview.id + "?download=1",
                ).catch((e) => notice(e.message, true))
              }
            >
              <Download size={16} />
              下载图片
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
