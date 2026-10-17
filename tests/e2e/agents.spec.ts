import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const password = "Browser-acceptance-synthetic-password";
const base = "http://127.0.0.1:3100";
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("工作区密码").fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(
    page.getByRole("heading", { name: "好内容，从这里发生。" }),
  ).toBeVisible();
}
async function nav(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: new RegExp("^" + name + "(?:\\s+\\d+)?$") })
    .click();
}

test("real REST executor and official MCP SDK hand off scoped data and immutable files", async ({
  request,
  page,
}) => {
  const logged = await request.post("/api/auth/login", {
    headers: { Origin: base },
    data: { password },
  });
  expect(logged.status()).toBe(200);
  const created = await request.post("/api/v1/admin/projects", {
    headers: { Origin: base },
    data: { name: "验收示例 · 多 Agent 协作" },
  });
  expect(created.status()).toBe(200);
  const project = (await created.json()).data.id;
  async function key(name: string, scopes: string[]) {
    const r = await request.post("/api/v1/admin/agents", {
      headers: { Origin: base },
      data: { name, project_ids: [project], scopes },
    });
    expect(r.status()).toBe(200);
    return (await r.json()).data;
  }
  const research = await key("示例 · 调研 Agent", [
    "source:read",
    "source:write",
    "changes:read",
  ]);
  const writing = await key("示例 · 写作 Agent", [
    "source:read",
    "content:read",
    "content:write",
    "file:read",
    "file:write",
    "artifact:read",
    "artifact:write",
    "changes:read",
  ]);
  const source = await request.post("/api/v1/sources", {
    headers: {
      Authorization: "Bearer " + research.token,
      "Idempotency-Key": "e2e-source-" + randomUUID(),
    },
    data: {
      project_id: project,
      title: "验收参考资料",
      markdown: "统一的数据中枢让来源、版本和输出文件能在不同执行器之间追溯。",
    },
  });
  expect(source.status()).toBe(201);
  const sourceId = (await source.json()).data.id;
  const client = new Client({
    name: "content-hub-e2e-official-sdk",
    version: "1.0.0",
  });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
        requestInit: { headers: { Authorization: "Bearer " + writing.token } },
      }),
    );
    const tools = await client.listTools();
    expect(
      tools.tools.some((t) => t.name === "content_create" && t.outputSchema),
    ).toBe(true);
    const read: any = await client.callTool({
      name: "source_get",
      arguments: { project_id: project, id: sourceId, view: "markdown" },
    });
    expect(read.isError).toBeFalsy();
    expect(read.structuredContent.data.text).toContain("不同执行器");
    const body = {
      project_id: project,
      title: "验收示例 · REST 到 MCP 接力",
      source_ids: [sourceId],
      markdown: "## 协作结论\n原文、版本与输出文件由同一个中枢可靠保存。",
    };
    const operationKey = "e2e-draft-" + randomUUID();
    const draft: any = await client.callTool({
      name: "content_create",
      arguments: { ...body, idempotency_key: operationKey },
    });
    expect(draft.isError).toBeFalsy();
    const id = draft.structuredContent.data.id;
    const replay = await request.post("/api/v1/contents", {
      headers: {
        Authorization: "Bearer " + writing.token,
        "Idempotency-Key": operationKey,
      },
      data: body,
    });
    expect(replay.status()).toBe(201);
    const receipt = await replay.json();
    expect(receipt.meta.replayed).toBe(true);
    expect(receipt.data.id).toBe(id);
    const file: any = await client.callTool({
      name: "file_save_text",
      arguments: {
        project_id: project,
        name: "demo.html",
        mime: "text/html",
        text: "<!doctype html><h1>真实外部文件验收</h1>",
        idempotency_key: "e2e-file-" + randomUUID(),
      },
    });
    expect(file.isError).toBeFalsy();
    const artifact: any = await client.callTool({
      name: "artifact_register",
      arguments: {
        project_id: project,
        content_id: id,
        content_version: 1,
        file_id: file.structuredContent.data.id,
        kind: "html",
        variant: "external-web",
        idempotency_key: "e2e-artifact-" + randomUUID(),
      },
    });
    expect(artifact.isError).toBeFalsy();
    const download = await request.get(
      "/api/v1/artifacts/" +
        artifact.structuredContent.data.id +
        "/download?project_id=" +
        project,
      { headers: { Authorization: "Bearer " + writing.token } },
    );
    expect(download.status()).toBe(200);
    expect(await download.text()).toBe(
      "<!doctype html><h1>真实外部文件验收</h1>",
    );
    const denied = await request.get(
      "/api/v1/contents/" + id + "?project_id=default",
      { headers: { Authorization: "Bearer " + writing.token } },
    );
    expect(denied.status()).toBe(403);
  } finally {
    await client.close();
  }
  await login(page);
  await nav(page, "Agent 管理台");
  await expect(
    page.getByRole("heading", { name: "Agent 管理台", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("示例 · 写作 Agent", { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/agent-console.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/agent-console-mobile.png",
    fullPage: true,
  });
});

test("first-save response cannot overwrite new typing or remount the editor; deletion is undoable", async ({
  page,
}) => {
  await login(page);
  await nav(page, "内容库");
  await page
    .getByRole("button", { name: "新建内容", exact: true })
    .first()
    .click();
  await page.getByLabel("内容标题").fill("慢网保存验收");
  await page.getByLabel("区块 1 正文").fill("保存请求发出前的内容");
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    ready = new Promise<void>((r) => (reached = r));
  await page.route(/\/api\/contents$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    reached();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "保存内容", exact: true }).click();
  await ready;
  await page.getByLabel("内容标题").fill("慢网保存后仍保留的新标题");
  await page
    .getByLabel("区块 1 正文")
    .fill("请求过程中继续输入的新内容，不能丢失。");
  release();
  await expect(page.locator(".save-indicator")).toContainText("有未保存的修改");
  await expect(page.getByLabel("区块 1 正文")).toHaveValue(
    "请求过程中继续输入的新内容，不能丢失。",
  );
  await expect(page.getByLabel("内容标题")).toHaveValue(
    "慢网保存后仍保留的新标题",
  );
  await page.unroute(/\/api\/contents$/);
  await page.getByRole("button", { name: "保存内容", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("已保存 · v2");
  await page.reload();
  await expect(page.getByLabel("区块 1 正文")).toHaveValue(
    "请求过程中继续输入的新内容，不能丢失。",
  );
  await page.getByRole("button", { name: "删除区块", exact: true }).click();
  await expect(page.getByLabel("区块 1 正文")).toHaveCount(0);
  await page.getByRole("button", { name: "撤销删除", exact: true }).click();
  await expect(page.getByLabel("区块 1 正文")).toHaveValue(
    "请求过程中继续输入的新内容，不能丢失。",
  );
});

test("save failure keeps the draft and offers a retry without discarding edits", async ({
  page,
}) => {
  await login(page);
  await nav(page, "内容库");
  await page
    .getByRole("button", { name: "新建内容", exact: true })
    .first()
    .click();
  await page.getByLabel("内容标题").fill("保存恢复验收");
  await page.getByLabel("区块 1 正文").fill("失败后仍留在当前页面");
  await page.route(/\/api\/contents$/, async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "模拟网络不可用" }),
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "保存内容", exact: true }).click();
  await expect(page.locator(".editor-save-error")).toContainText(
    "模拟网络不可用",
  );
  await expect(page.getByLabel("区块 1 正文")).toHaveValue(
    "失败后仍留在当前页面",
  );
  await page.unroute(/\/api\/contents$/);
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("已保存 · v1");
  await expect(page.locator(".editor-save-error")).toHaveCount(0);
});

test("Agent console requires project and scope and keeps one-time secrets out of the listing", async ({
  page,
}) => {
  await login(page);
  await nav(page, "Agent 管理台");
  await page.getByRole("button", { name: "连接 Agent", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Agent 名称", { exact: true })
    .fill("示例 · 网页新建只读 Agent");
  await dialog.getByRole("button", { name: "创建授权并显示密钥" }).click();
  await expect(page.getByLabel("Agent Bearer Token")).toBeVisible();
  const secret = await page.getByLabel("Agent Bearer Token").inputValue();
  expect(secret.length).toBeGreaterThan(20);
  await page.getByRole("button", { name: "我已保存，关闭密钥" }).click();
  await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
  const card = page
    .locator(".agent-card")
    .filter({ hasText: "示例 · 网页新建只读 Agent" });
  await card.getByRole("button", { name: "撤销", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认撤销" })
    .click();
  await expect(card).toContainText("已撤销");
});
