"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X, LoaderCircle, ArrowUpRight, Inbox } from "lucide-react";
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response
    .json()
    .catch(() => ({ error: "服务器返回了无效响应" }));
  if (!response.ok)
    throw new Error(data.error || `请求失败 (${response.status})`);
  return data as T;
}
export async function upload<T>(path: string, file: File): Promise<T> {
  const response = await fetch("/api/" + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "上传失败");
  return data as T;
}
export async function downloadFile(path: string) {
  const response = await fetch("/api/" + path);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "下载失败");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const name = response.headers
    .get("content-disposition")
    ?.match(/filename\*=UTF-8''(.+)$/)?.[1];
  a.download = name ? decodeURIComponent(name) : "content-hub-export";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={"modal " + (wide ? "modal-wide" : "")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭弹窗">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Spinner() {
  return <LoaderCircle size={17} className="spin" aria-label="处理中" />;
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Inbox size={26} strokeWidth={1.3} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
const names: Record<string, string> = {
  draft: "草稿",
  ready: "待分发",
  archived: "已归档",
  submitted: "待审核",
  published: "已发布",
  rejected: "未通过",
  removed: "已下架",
};
export function Badge({ value }: { value: string }) {
  return (
    <span className={"badge badge-" + value}>
      <i />
      {names[value] || value}
    </span>
  );
}
export function External({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="external">
      {children}
      <ArrowUpRight size={14} />
    </a>
  );
}
export const formatDate = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export const sizeLabel = (bytes: number) =>
  bytes >= 1048576
    ? (bytes / 1048576).toFixed(1) + " MB"
    : Math.max(1, Math.round(bytes / 1024)) + " KB";
export type Notice = (text: string, error?: boolean) => void;
