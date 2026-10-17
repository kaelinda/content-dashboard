import { test, expect, type Page } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("工作区密码").fill("Browser-acceptance-synthetic-password");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.getByRole("heading", { name: "好内容，从这里发生。" })).toBeVisible();
}

async function dismissNotice(page: Page) {
  const dismiss = page.getByRole("button", { name: "关闭提示", exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
}

test("owner configures a scoped agent; real REST and MCP SDK clients exchange data", async ({ page, baseURL }) => {
  await login(page);
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "Agent 控制台", exact: true }).click();
  await expect(page.getByRole("heading", { name: "让 Agent 协作，让数据有据。" })).toBeVisible();
  await page.getByRole("button", { name: "连接新 Agent" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("名称", { exact: true }).fill("验收 · 跨客户端写作助手");
  await dialog.getByLabel("权限模板").selectOption({ label: "写作助手" });
  await dialog.getByLabel("保存来源", { exact: true }).check();
  // The template label must match the effective manually edited grants.
  await expect(dialog.getByLabel("权限模板")).toHaveValue("custom");
  await dialog.getByRole("button", { name: "创建身份", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const card = page.locator(".agent-card").filter({ hasText: "验收 · 跨客户端写作助手" });
  await card.getByRole("button", { name: "生成令牌" }).click();
  const token = await page.getByLabel("新 Agent 令牌").inputValue();
  expect(token.length).toBeGreaterThan(20);
  await page.getByRole("dialog").getByRole("button", { name: "关闭弹窗", exact: true }).click();
  // A separate HTTP client writes a real source through the live Next.js service.
  const key = "browser-source-" + randomUUID();
  const input = {
    project_id: "default",
    title: "验收 · REST 保存的研究资料",
    markdown: "这段资料由 REST 写入，再由 MCP SDK 读取。",
  };
  const sourceResponse = await fetch(baseURL + "/api/v1/sources", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(input),
  });
  expect(sourceResponse.status).toBe(201);
  const source = await sourceResponse.json();
  const client = new Client({ name: "Content-Hub-Acceptance", version: "1.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(baseURL + "/mcp"), {
    requestInit: { headers: { Authorization: "Bearer " + token } },
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === "content_create")).toBeTruthy();
    const result = await client.callTool({ name: "source_get", arguments: { id: source.data.id, view: "markdown" } });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.structuredContent)).toContain(input.markdown);
    const replay = await client.callTool({ name: "source_save", arguments: { ...input, idempotency_key: key } });
    expect((replay.structuredContent as { meta: { replayed: boolean } }).meta.replayed).toBe(true);
    const created = await client.callTool({
      name: "content_create",
      arguments: {
        project_id: "default", title: "验收 · MCP 创作的文章",
        markdown: "来自两个不同接入方式的完整接力。", source_ids: [source.data.id],
        idempotency_key: "browser-content-" + randomUUID(),
      },
    });
    expect(created.isError).not.toBe(true);
    const saved = created.structuredContent as { data: { id: string; version: number } };
    const read = await fetch(baseURL + `/api/v1/contents/${saved.data.id}?view=markdown&version=${saved.data.version}`, {
      headers: { Authorization: "Bearer " + token },
    });
    expect(read.status).toBe(200);
    expect((await read.json()).data.text).toContain("完整接力");
  } finally {
    await client.close();
  }
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.locator(".agent-table")).toContainText("content_create");
  await dismissNotice(page);
  await page.screenshot({ path: "test-results/agent-console-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  // Responsive changes transition the sidebar: assert its actual settled state,
  // not merely that an off-screen element does not widen the document.
  await expect(page.locator(".sidebar")).toBeHidden();
  const connect = page.getByRole("button", { name: "连接新 Agent", exact: true });
  await expect(connect).toBeVisible();
  const bounds = await connect.boundingBox();
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await page.getByRole("button", { name: "关闭导航", exact: true }).click({ position: { x: 380, y: 50 } });
  await expect(page.locator(".sidebar")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/agent-console-mobile.png", fullPage: true, animations: "disabled" });
});

test("slow first-save response cannot erase newer typing; deleted blocks can be restored", async ({ page }) => {
  await login(page);
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: /^内容库/ }).click();
  await page.getByRole("button", { name: "新建内容", exact: true }).first().click();
  await page.getByLabel("内容标题").fill("慢网保存保护验收");
  await page.getByLabel("区块 1 正文").fill("已提交的文字");
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let reached!: () => void;
  const submitted = new Promise<void>((r) => { reached = r; });
  await page.route("**/api/contents", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    const response = await route.fetch();
    reached();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "保存内容", exact: true }).click();
  await submitted;
  await page.getByLabel("区块 1 正文").fill("已提交的文字 + 保存请求之后继续输入的文字");
  release();
  await expect(page.getByText("有未保存的修改", { exact: true })).toBeVisible();
  await expect(page.getByLabel("区块 1 正文")).toHaveValue("已提交的文字 + 保存请求之后继续输入的文字");
  await page.unroute("**/api/contents");
  await page.getByRole("button", { name: "保存内容", exact: true }).click();
  await expect(page.getByText("已保存 · v2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "删除区块", exact: true }).click();
  await expect(page.getByLabel("区块 1 正文")).toHaveCount(0);
  await page.getByRole("button", { name: "撤销删除", exact: true }).click();
  await expect(page.getByLabel("区块 1 正文")).toHaveValue("已提交的文字 + 保存请求之后继续输入的文字");
  await dismissNotice(page);
  await page.screenshot({ path: "test-results/agent-editor-save-safety.png", fullPage: true });
  await page.reload();
  await expect(page.getByLabel("区块 1 正文")).toHaveValue("已提交的文字 + 保存请求之后继续输入的文字");
});

test("external file upload and artifact bytes are verified over live HTTP", async ({ page, baseURL }) => {
  await login(page);
  const ownerHeaders = { Origin: baseURL! };
  const a = await page.request.post("/api/v1/agents", {
    headers: ownerHeaders,
    data: {
      name: "验收 · 文件执行器", project_ids: ["default"],
      scopes: ["contents:read", "contents:write", "files:read", "files:write", "artifacts:read", "artifacts:write"],
    },
  });
  expect(a.status()).toBe(201);
  const id = (await a.json()).data.id;
  const t = await page.request.post(`/api/v1/agents/${id}/tokens`, { headers: ownerHeaders, data: {} });
  const token = (await t.json()).data.token;
  const headers = { Authorization: "Bearer " + token };
  const c = await fetch(baseURL + "/api/v1/contents", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "Idempotency-Key": "live-content-" + randomUUID() },
    body: JSON.stringify({ project_id: "default", title: "文件产物测试", markdown: "正文" }),
  });
  const content = (await c.json()).data;
  const bytes = Buffer.from("<!doctype html><title>实际字节</title><h1>文件原样留存</h1>");
  const upload = await fetch(baseURL + "/api/v1/files?project_id=default", {
    method: "POST",
    headers: { ...headers, "Content-Type": "text/html", "X-Filename": "real.html", "Idempotency-Key": "live-file-" + randomUUID() },
    body: bytes,
  });
  expect(upload.status).toBe(201);
  const file = (await upload.json()).data;
  const registered = await fetch(baseURL + "/api/v1/artifacts", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "Idempotency-Key": "live-artifact-" + randomUUID() },
    body: JSON.stringify({ content_id: content.id, content_version: 1, file_id: file.id, kind: "html", variant: "web" }),
  });
  expect(registered.status).toBe(201);
  const artifact = (await registered.json()).data;
  const downloaded = await fetch(baseURL + `/api/v1/artifacts/${artifact.id}/download`, { headers });
  expect(downloaded.status).toBe(200);
  const actual = Buffer.from(await downloaded.arrayBuffer());
  expect(actual.equals(bytes)).toBe(true);
  expect(createHash("sha256").update(actual).digest("hex")).toBe(artifact.sha256);
  const docs = await page.request.get("/docs/agents");
  expect(docs.status()).toBe(200);
  const schema = await page.request.get("/openapi.json");
  expect((await schema.json()).openapi).toBe("3.1.1");
});
