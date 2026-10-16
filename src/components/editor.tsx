"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Plus,
  Save,
  Trash2,
  Download,
  BookOpen,
  FileText,
  History,
  Link2,
  ImagePlus,
  Check,
  ChevronDown,
} from "lucide-react";
import {
  type Block,
  type BlockType,
  type ContentDetail,
  type ContentInput,
  type Source,
  type Asset,
  type Artifact,
  blockTypes,
  renderOptions,
} from "@/lib/domain";
import {
  api,
  upload,
  downloadFile,
  Modal,
  Spinner,
  formatDate,
  type Notice,
} from "./ui";
export const blockLabels: Record<BlockType, string> = {
  heading: "标题",
  paragraph: "段落",
  quote: "引用",
  code: "代码",
  callout: "提示",
  image_prompt: "配图提示词",
  narration: "口播",
  image: "图片",
};
export function blankContent(source?: Source): ContentDetail {
  const now = new Date().toISOString();
  return {
    id: "",
    title: source ? source.title : "",
    status: "draft",
    tags: [],
    current_version: 0,
    version: 0,
    created_at: now,
    updated_at: now,
    source_ids: source ? [source.id] : [],
    blocks: (source?.markdown
      ? (source.markdown.match(/[\s\S]{1,28000}/g) ?? [""])
      : [""]
    )
      .slice(0, 18)
      .map((text) => ({
        id: crypto.randomUUID(),
        type: "paragraph",
        text,
        source_refs: source ? [source.id] : [],
      })),
  };
}
const draftOf = (c: ContentDetail): ContentInput => ({
  title: c.title,
  status: c.status,
  tags: c.tags,
  blocks: c.blocks,
  source_ids: c.source_ids,
});
export function ArticlePreview({
  title,
  blocks,
}: {
  title: string;
  blocks: Block[];
}) {
  return (
    <article className="article-preview">
      <div className="preview-kicker">CONTENT HUB · 阅读预览</div>
      <h1>{title || "未命名内容"}</h1>
      {blocks.map((b) => {
        switch (b.type) {
          case "image_prompt":
          case "narration":
            return null;
          case "heading":
            return b.level === 1 ? (
              <h1 key={b.id}>{b.text}</h1>
            ) : b.level === 3 ? (
              <h3 key={b.id}>{b.text}</h3>
            ) : (
              <h2 key={b.id}>{b.text}</h2>
            );
          case "quote":
            return (
              <blockquote key={b.id}>
                {b.text}
                {b.attribution && <footer>— {b.attribution}</footer>}
              </blockquote>
            );
          case "code":
            return (
              <pre key={b.id}>
                <code>{b.text}</code>
              </pre>
            );
          case "callout":
            return <aside key={b.id}>{b.text}</aside>;
          case "image":
            return (
              <figure key={b.id}>
                <img src={"/api/assets/" + b.asset_id} alt={b.text} />
                <figcaption>{b.text}</figcaption>
              </figure>
            );
          default:
            return <p key={b.id}>{b.text}</p>;
        }
      })}
    </article>
  );
}
export function Editor({
  initial,
  sources,
  assets,
  onBack,
  onSaved,
  onRefresh,
  notice,
  onDirty,
}: {
  initial: ContentDetail;
  sources: Source[];
  assets: Asset[];
  onBack: () => void;
  onSaved: (c: ContentDetail) => void;
  onRefresh: () => Promise<void>;
  notice: Notice;
  onDirty: (dirty: boolean) => void;
}) {
  const [record, setRecord] = useState(initial),
    [draft, setDraft] = useState<ContentInput>(draftOf(initial));
  const [saved, setSaved] = useState(JSON.stringify(draftOf(initial))),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState<"write" | "preview" | "history">("write");
  const [history, setHistory] = useState<
      { version: number; title: string; status: string; created_at: string }[]
    >([]),
    [renderOpen, setRenderOpen] = useState(false),
    [renderChoice, setRenderChoice] = useState("html:web"),
    [rendered, setRendered] = useState<Artifact | null>(null);
  const [tagsText, setTagsText] = useState(initial.tags.join(", "));
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const dirty = JSON.stringify(draft) !== saved;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api<ContentDetail>(
        "contents" + (record.id ? "/" + record.id : ""),
        record.id ? "PATCH" : "POST",
        {
          ...draft,
          ...(record.id ? { expected_version: record.current_version } : {}),
        },
      );
      setRecord(result);
      setDraft(draftOf(result));
      setTagsText(result.tags.join(", "));
      setSaved(JSON.stringify(draftOf(result)));
      setLoadedVersion(null);
      notice(`已保存为版本 v${result.version}`);
      window.history.replaceState({}, "", "/?content=" + encodeURIComponent(result.id));
      onSaved(result);
      await onRefresh();
    } catch (e) {
      notice((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  saveRef.current = save;
  const changeBlock = (id: string, patch: Partial<Block>) =>
    setDraft((d) => ({
      ...d,
      blocks: d.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  function addBlock(type: BlockType) {
    if (type === "image") {
      imageInput.current?.click();
      return;
    }
    setDraft((d) => ({
      ...d,
      blocks: [
        ...d.blocks,
        {
          id: crypto.randomUUID(),
          type,
          text: "",
          source_refs: [],
          ...(type === "heading" ? { level: 2 } : {}),
          ...(type === "narration" ? { duration_hint: 8 } : {}),
        },
      ],
    }));
  }
  function moveBlock(index: number, delta: number) {
    setDraft((d) => {
      const blocks = [...d.blocks];
      const other = index + delta;
      if (other < 0 || other >= blocks.length) return d;
      [blocks[index], blocks[other]] = [blocks[other], blocks[index]];
      return { ...d, blocks };
    });
  }
  async function uploadImage(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const asset = await upload<Asset>("assets", file);
      setDraft((d) => ({
        ...d,
        blocks: [
          ...d.blocks,
          {
            id: crypto.randomUUID(),
            type: "image",
            text: file.name,
            asset_id: asset.id,
            source_refs: [],
          },
        ],
      }));
      await onRefresh();
      notice("图片已安全存入素材库");
    } catch (e) {
      notice((e as Error).message, true);
    } finally {
      setBusy(false);
      if (imageInput.current) imageInput.current.value = "";
    }
  }
  async function loadHistory() {
    if (!record.id) {
      notice("保存后即可查看版本历史");
      return;
    }
    try {
      setHistory(await api("contents/" + record.id + "/versions"));
      setTab("history");
    } catch (e) {
      notice((e as Error).message, true);
    }
  }
  async function useVersion(version: number) {
    if (dirty && !confirm("载入历史版本会替换当前未保存的编辑，是否继续？"))
      return;
    try {
      const c = await api<ContentDetail>(
        `contents/${record.id}?version=${version}`,
      );
      setDraft(draftOf(c));
      setTagsText(c.tags.join(", "));
      setLoadedVersion(version);
      setTab("write");
      notice(`已载入 v${version}。保存将创建新版本，不会改写历史。`);
    } catch (e) {
      notice((e as Error).message, true);
    }
  }
  async function render() {
    setBusy(true);
    try {
      const [kind, variant] = renderChoice.split(":");
      setRendered(
        await api<Artifact>(`contents/${record.id}/render`, "POST", {
          version: record.current_version,
          kind,
          variant,
        }),
      );
      await onRefresh();
      notice("产物已生成并永久冻结");
    } catch (e) {
      notice((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const wordCount = draft.blocks.reduce((n, b) => n + b.text.length, 0);
  return (
    <div className="editor-view">
      <div className="editor-toolbar">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={17} />
          返回内容库
        </button>
        <div className="editor-actions">
          <span className={"save-indicator " + (dirty ? "unsaved" : "")}>
            <i />
            {busy
              ? "处理中…"
              : dirty
                ? "有未保存的修改"
                : record.id
                  ? "已保存 · v" + record.current_version
                  : "尚未保存"}
          </span>
          <button
            className="button secondary"
            disabled={busy || dirty || !record.id}
            onClick={() => {
              setRendered(null);
              setRenderOpen(true);
            }}
            title={dirty ? "请先保存修改" : "生成冻结产物"}
          >
            <Download size={16} />
            生成产物
          </button>
          <button
            className="button primary"
            onClick={() => void save()}
            disabled={busy}
          >
            {busy ? <Spinner /> : <Save size={16} />}保存内容
          </button>
        </div>
      </div>
      <div className="editor-layout">
        <section className="editor-main">
          <div className="editor-title">
            <div className="eyebrow">YOUR NEXT GREAT STORY</div>
            <input
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
              placeholder="给这篇内容一个好标题"
              maxLength={200}
              aria-label="内容标题"
            />
            <div className="editor-meta">
              <span>{wordCount.toLocaleString()} 字符</span>
              <span>·</span>
              <span>{draft.blocks.length} 个区块</span>
              <span>·</span>
              <span>{draft.source_ids.length} 个来源</span>
            </div>
          </div>
          <div className="editor-tabs">
            <button
              className={tab === "write" ? "active" : ""}
              onClick={() => setTab("write")}
            >
              <FileText size={15} />
              结构化编辑
            </button>
            <button
              className={tab === "preview" ? "active" : ""}
              onClick={() => setTab("preview")}
            >
              <BookOpen size={15} />
              阅读预览
            </button>
            <button
              className={tab === "history" ? "active" : ""}
              onClick={() => void loadHistory()}
            >
              <History size={15} />
              版本历史
            </button>
          </div>
          {loadedVersion !== null && (
            <div className="inline-note">
              正在基于 v{loadedVersion} 编辑。保存后将产生 v
              {record.current_version + 1}，旧版本保持不变。
            </div>
          )}
          {tab === "write" && (
            <div className="blocks-editor">
              {draft.blocks.map((block, index) => (
                <section
                  key={block.id}
                  className={"block-editor block-" + block.type}
                  data-testid="block-editor"
                >
                  <div className="block-toolbar">
                    <span className="block-seq">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <select
                      aria-label={"区块 " + (index + 1) + " 类型"}
                      value={block.type}
                      onChange={(e) => {
                        const type = e.target.value as BlockType;
                        if (type === "image" && !block.asset_id) {
                          notice("请用下方“图片”按钮上传素材");
                          return;
                        }
                        changeBlock(block.id, { type });
                      }}
                    >
                      {blockTypes.map((type) => (
                        <option key={type} value={type}>
                          {blockLabels[type]}
                        </option>
                      ))}
                    </select>
                    {block.type === "heading" && (
                      <select
                        value={block.level ?? 2}
                        onChange={(e) =>
                          changeBlock(block.id, {
                            level: Number(e.target.value),
                          })
                        }
                        aria-label="标题层级"
                      >
                        <option value={1}>H1</option>
                        <option value={2}>H2</option>
                        <option value={3}>H3</option>
                      </select>
                    )}
                    {block.type === "image_prompt" && (
                      <select
                        value={block.aspect ?? "3:4"}
                        onChange={(e) =>
                          changeBlock(block.id, { aspect: e.target.value })
                        }
                        aria-label="配图比例"
                      >
                        {["3:4", "16:9", "1:1", "9:16"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    )}
                    {block.type === "narration" && (
                      <label className="duration">
                        <input
                          type="number"
                          min={1}
                          max={600}
                          value={block.duration_hint ?? 8}
                          onChange={(e) =>
                            changeBlock(block.id, {
                              duration_hint: Number(e.target.value),
                            })
                          }
                          aria-label="口播秒数"
                        />
                        秒
                      </label>
                    )}
                    {block.type === "code" && (
                      <input
                        className="code-lang"
                        aria-label="代码语言"
                        placeholder="语言，如 ts"
                        value={block.lang ?? ""}
                        maxLength={30}
                        onChange={(e) =>
                          changeBlock(block.id, { lang: e.target.value })
                        }
                      />
                    )}
                    <div className="block-tools">
                      <button
                        className="icon-button small"
                        aria-label="上移区块"
                        disabled={index === 0}
                        onClick={() => moveBlock(index, -1)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        className="icon-button small"
                        aria-label="下移区块"
                        disabled={index === draft.blocks.length - 1}
                        onClick={() => moveBlock(index, 1)}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        className="icon-button small danger"
                        aria-label="删除区块"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            blocks: d.blocks.filter((b) => b.id !== block.id),
                          }))
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {block.type === "image" && (
                    <div className="editor-image">
                      <img
                        src={"/api/assets/" + block.asset_id}
                        alt={block.text}
                      />
                    </div>
                  )}
                  <textarea
                    aria-label={"区块 " + (index + 1) + " 正文"}
                    value={block.text}
                    rows={
                      block.type === "heading"
                        ? 2
                        : block.type === "code"
                          ? 6
                          : Math.max(
                              3,
                              Math.min(12, block.text.split("\n").length + 2),
                            )
                    }
                    placeholder={
                      block.type === "image"
                        ? "为图片添加说明文字…"
                        : block.type === "image_prompt"
                          ? "描述这幅配图的构图、风格和核心信息…"
                          : block.type === "narration"
                            ? "写下这段画面对应的口播…"
                            : "把你的想法写在这里…"
                    }
                    onChange={(e) =>
                      changeBlock(block.id, { text: e.target.value })
                    }
                    maxLength={30000}
                  />
                  {block.type === "quote" && (
                    <input
                      className="attribution"
                      placeholder="引用署名（可选）"
                      aria-label="引用署名"
                      value={block.attribution ?? ""}
                      onChange={(e) =>
                        changeBlock(block.id, { attribution: e.target.value })
                      }
                    />
                  )}
                  {draft.source_ids.length > 0 && (
                    <details className="block-cites">
                      <summary>
                        <Link2 size={13} />
                        {block.source_refs.length
                          ? "已引用 " + block.source_refs.length + " 个来源"
                          : "关联论据来源"}
                        <ChevronDown size={12} />
                      </summary>
                      <div>
                        {draft.source_ids.map((id) => (
                          <label key={id}>
                            <input
                              type="checkbox"
                              checked={block.source_refs.includes(id)}
                              onChange={(e) =>
                                changeBlock(block.id, {
                                  source_refs: e.target.checked
                                    ? [...block.source_refs, id]
                                    : block.source_refs.filter((v) => v !== id),
                                })
                              }
                            />
                            {sources.find((s) => s.id === id)?.title || id}
                          </label>
                        ))}
                      </div>
                    </details>
                  )}
                </section>
              ))}
              <div className="add-blocks">
                <span>添加区块</span>
                {blockTypes.map((type) => (
                  <button
                    key={type}
                    onClick={() => addBlock(type)}
                    disabled={busy}
                  >
                    <Plus size={13} />
                    {blockLabels[type]}
                  </button>
                ))}
              </div>
              <input
                ref={imageInput}
                type="file"
                hidden
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => void uploadImage(e.target.files?.[0])}
              />
            </div>
          )}
          {tab === "preview" && (
            <>
              <div className="preview-note">
                文字产物不包含配图提示词与口播区块；图片在导出时嵌入文件。
              </div>
              <ArticlePreview title={draft.title} blocks={draft.blocks} />
            </>
          )}
          {tab === "history" && (
            <div className="version-list">
              {history.map((v) => (
                <div className="version-item" key={v.version}>
                  <div className="version-icon">v{v.version}</div>
                  <div>
                    <h3>{v.title}</h3>
                    <p>
                      {formatDate(v.created_at)}
                      {v.version === record.current_version
                        ? " · 当前版本"
                        : ""}
                    </p>
                  </div>
                  <button
                    className="button secondary compact"
                    onClick={() => void useVersion(v.version)}
                  >
                    载入编辑
                  </button>
                </div>
              ))}
              <p className="fine-print">
                历史正文和标题不可修改。载入旧版本后保存，只会追加一个新版本。
              </p>
            </div>
          )}
        </section>
        <aside className="editor-inspector">
          <div className="inspector-section">
            <h3>内容属性</h3>
            <label className="field">
              状态
              <select
                value={draft.status}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    status: e.target.value as ContentInput["status"],
                  }))
                }
              >
                <option value="draft">草稿 · 继续打磨</option>
                <option value="ready">待分发 · 准备就绪</option>
                <option value="archived">已归档 · 长期保存</option>
              </select>
            </label>
            <label className="field">
              标签
              <input
                value={tagsText}
                placeholder="用英文逗号分隔"
                onChange={(e) => {
                  setTagsText(e.target.value);
                  setDraft((d) => ({
                    ...d,
                    tags: e.target.value
                      .split(/[,，]/)
                      .map((v) => v.trim())
                      .filter(Boolean)
                      .slice(0, 20),
                  }));
                }}
              />
            </label>
          </div>
          <div className="inspector-section">
            <h3>
              <Link2 size={15} />
              关联来源 <span>{draft.source_ids.length}</span>
            </h3>
            <p>先关联信息源，再把具体论据挂到正文区块。</p>
            <div className="source-checks">
              {sources.length ? (
                sources.map((source) => (
                  <label key={source.id}>
                    <input
                      type="checkbox"
                      checked={draft.source_ids.includes(source.id)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setDraft((d) => ({
                          ...d,
                          source_ids: checked
                            ? [...d.source_ids, source.id]
                            : d.source_ids.filter((id) => id !== source.id),
                          blocks: checked
                            ? d.blocks
                            : d.blocks.map((b) => ({
                                ...b,
                                source_refs: b.source_refs.filter(
                                  (id) => id !== source.id,
                                ),
                              })),
                        }));
                      }}
                    />
                    <span>
                      {source.title}
                      <small>
                        {source.original_url
                          ? new URL(source.original_url).hostname
                          : "手工 / 文件导入"}
                      </small>
                    </span>
                  </label>
                ))
              ) : (
                <div className="inspector-empty">
                  暂时没有来源。可从侧边栏“信息源”导入链接或原文。
                </div>
              )}
            </div>
          </div>
          {assets.length > 0 && (
            <div className="inspector-section">
              <h3>
                <ImagePlus size={15} />
                已有图片
              </h3>
              <select
                aria-label="插入已有素材"
                value=""
                onChange={(e) => {
                  const asset = assets.find((a) => a.id === e.target.value);
                  if (asset)
                    setDraft((d) => ({
                      ...d,
                      blocks: [
                        ...d.blocks,
                        {
                          id: crypto.randomUUID(),
                          type: "image",
                          text: asset.name,
                          asset_id: asset.id,
                          source_refs: [],
                        },
                      ],
                    }));
                }}
              >
                <option value="">选择素材插入正文…</option>
                {assets.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="inspector-tip">
            <span className="tip-dot" />
            <div>
              <strong>正文是原料，产物是快照。</strong>
              <p>修改正文不会覆盖已生成的 HTML、Markdown 或分镜文件。</p>
            </div>
          </div>
        </aside>
      </div>
      {renderOpen && (
        <Modal
          title={rendered ? "产物已冻结" : "从当前版本生成产物"}
          onClose={() => {
            if (!busy) setRenderOpen(false);
          }}
        >
          {rendered ? (
            <div className="modal-body">
              <div className="success-mark">
                <Check size={25} />
              </div>
              <h3 className="center">
                v{rendered.content_version} 的产物已安全留存
              </h3>
              <p className="muted center">
                这个文件不会随正文修改而改变。重复生成相同产物会自动去重。
              </p>
              <div className="hash-box">
                SHA-256
                <br />
                {rendered.sha256}
              </div>
              <button
                className="button primary full"
                onClick={() =>
                  void downloadFile(
                    "artifacts/" + rendered.id + "/download",
                  ).catch((e) => notice(e.message, true))
                }
              >
                <Download size={16} />
                下载产物
              </button>
            </div>
          ) : (
            <div className="modal-body">
              <p className="muted">
                来源：{record.title} · v{record.current_version}
              </p>
              <label className="field">
                输出格式
                <select
                  value={renderChoice}
                  onChange={(e) => setRenderChoice(e.target.value)}
                >
                  {renderOptions.map((o) => (
                    <option
                      value={o.kind + ":" + o.variant}
                      key={o.kind + o.variant}
                    >
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="inline-note">
                分镜与配图提示词导出为
                JSON，不会伪装成已生成的视频或图片。公众号 HTML
                是排版稿，正式上传时仍需平台适配。
              </div>
              <button
                className="button primary full"
                disabled={busy}
                onClick={() => void render()}
              >
                {busy ? <Spinner /> : <Download size={16} />}生成并冻结
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
