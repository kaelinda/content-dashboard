"use client";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  Copy,
  Search,
  type LucideIcon,
} from "lucide-react";
import { formatDate, type Notice } from "../ui";

export type AgentRecord = {
  id: string;
  name: string;
  scopes: string[];
  project_ids: string[];
  active: boolean;
  created_at?: string;
};
export type ProjectRecord = { id: string; name: string; created_at?: string };
export type RequestRecord = {
  request_id: string;
  principal_id: string;
  operation: string;
  status: number;
  code: string | null;
  duration_ms: number;
  created_at: string;
};
export type AdminData = {
  agents: AgentRecord[];
  projects: ProjectRecord[];
  scopes: string[];
  requests: RequestRecord[];
};
export const scopeLabels: Record<string, string> = {
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
export const platformLabels: Record<string, string> = {
  wechat: "微信公众号",
  x: "X",
  xiaohongshu: "小红书",
  zhihu: "知乎",
  douyin: "抖音",
  other: "其他平台",
};
export const safeDate = (date?: string | null) =>
  date && !Number.isNaN(Date.parse(date)) ? formatDate(date) : "尚无记录";
export const safeUrl = (url?: string | null) => {
  if (!url) return null;
  try {
    const value = new URL(url);
    return ["https:", "http:"].includes(value.protocol) &&
      !value.username &&
      !value.password
      ? value.href
      : null;
  } catch {
    return null;
  }
};
export const domainLabel = (url?: string | null) => {
  const value = safeUrl(url);
  return value ? new URL(value).hostname : "文本 / 文件归档";
};
export async function adminRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/v1/" + path, {
    method,
    signal,
    cache: "no-store",
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.detail ?? "操作未完成，请重试。");
  return result.data;
}
export function useAdminSnapshot(revision: unknown) {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void adminRequest<AdminData>("admin", "GET", undefined, controller.signal)
      .then((value) => {
        setData(value);
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [revision, retry]);
  return { data, error, retry: () => setRetry((n) => n + 1) };
}
export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="studio-heading">
      <div>
        {eyebrow && <div className="studio-eyebrow">{eyebrow}</div>}
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
  value: ReactNode;
  note: string;
  icon: LucideIcon;
  tone?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className={`studio-icon tone-${tone}`}>
        <Icon size={23} strokeWidth={1.7} />
      </span>
      <div className="metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
      {onClick && <ArrowUpRight className="metric-arrow" size={16} />}
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
export function PanelHeading({
  title,
  count,
  action,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="studio-panel-heading">
      <h2>
        {title}
        {count !== undefined && <span className="studio-count">{count}</span>}
      </h2>
      {action}
    </div>
  );
}
export function QueryInput({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (s: string) => void;
  label: string;
  placeholder?: string;
}) {
  return (
    <label className="studio-query">
      <Search size={16} />
      <input
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function CopyButton({
  value,
  label = "复制",
  notice,
}: {
  value: string;
  label?: string;
  notice: Notice;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={() =>
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            notice("已复制");
          })
          .catch(() => notice("复制失败，请手动选择文本复制。", true))
      }
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </button>
  );
}
export function RequestTable({
  requests,
  agents,
  limit = 30,
}: {
  requests: RequestRecord[];
  agents: AgentRecord[];
  limit?: number;
}) {
  return requests.length ? (
    <div className="studio-table-scroll">
      <table className="studio-table agent-table">
        <thead>
          <tr>
            <th>操作 / 请求</th>
            <th>调用身份</th>
            <th>结果</th>
            <th>耗时</th>
          </tr>
        </thead>
        <tbody>
          {requests.slice(0, limit).map((r) => (
            <tr key={r.request_id}>
              <td>
                <strong className="mono">{r.operation}</strong>
                <small>{safeDate(r.created_at)}</small>
                <details className="request-details">
                  <summary>请求 ID</summary>
                  <code>{r.request_id}</code>
                </details>
              </td>
              <td>
                {agents.find((a) => a.id === r.principal_id)?.name ??
                  (r.principal_id === "owner"
                    ? "工作区所有者"
                    : r.principal_id)}
              </td>
              <td>
                <span
                  className={`studio-status ${r.status < 400 ? "enabled" : "failed"}`}
                >
                  <i />
                  {r.status < 400 ? "成功" : (r.code ?? "失败")}
                </span>
              </td>
              <td className="mono">{r.duration_ms} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="studio-empty-compact">
      尚无调用记录。Agent 接入后将在这里显示真实请求。
    </div>
  );
}
