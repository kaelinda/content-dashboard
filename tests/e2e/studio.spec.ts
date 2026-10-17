import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";

const titles = [
  "示例 · 多 Agent 内容生产工作流",
  "示例 · 把资料沉淀为长期知识资产",
  "示例 · 从原始来源到发布文件",
  "示例 · 内容中枢接口设计手记",
  "示例 · 每次修改都留下清晰版本",
  "示例 · 建立可追溯的研究资料库",
];
let sourceIds: string[] = [];
let contentIds: string[] = [];
let selectedHtmlId = "";
async function login(page: Page) {
  await page.goto("/");
  await page
    .getByLabel("工作区密码")
    .fill("Browser-acceptance-synthetic-password");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(
    page.getByRole("heading", { name: "让 Agent 协作，让数据有据。" }),
  ).toBeVisible();
}
async function nav(page: Page, name: string) {
  if (
    await page
      .getByRole("button", { name: "打开导航", exact: true })
      .isVisible()
  )
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: new RegExp("^" + name + "(?:\\s+\\d+)?$") })
    .click();
}
async function dismiss(page: Page) {
  const button = page.getByRole("button", { name: "关闭提示", exact: true });
  if (await button.isVisible()) await button.click();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test.beforeAll(async ({ request, baseURL }) => {
  const loginResponse = await request.post("/api/auth/login", {
    headers: { Origin: baseURL! },
    data: { password: "Browser-acceptance-synthetic-password" },
  });
  expect(loginResponse.ok()).toBe(true);
  async function write(path: string, data: unknown) {
    const response = await request.post(path, {
      headers: { Origin: baseURL! },
      data,
    });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return response.json();
  }
  for (const [i, title] of [
    "示例 · Agent 接入规范",
    "示例 · 团队知识整理笔记",
    "示例 · 版本与追溯设计",
    "示例 · 发布流程检查表",
    "示例 · 开放接口参考",
    "示例 · 资料复用实践",
  ].entries()) {
    const source = await write("/api/sources", {
      title,
      markdown: `这是用于 UI 验收的示例资料 ${i + 1}，不代表真实研究或官方来源。\n\n每个 Agent 通过授权接口读取资料。系统保留来源快照与内容版本，便于复用和追溯。\n\n写入前确认项目权限，重试时使用相同幂等键。发布动作需要单独授权，登记记录并不代表自动发文。`,
      url: i % 2 === 0 ? `https://example.org/reference/${i}` : "",
      trust_level: i === 0 ? "high" : "medium",
    });
    sourceIds.push(source.id);
  }
  for (const [i, title] of titles.entries()) {
    const result = await write("/api/contents", {
      title,
      status: i % 3 === 0 ? "ready" : "draft",
      tags: ["示例数据", "Agent", i % 2 ? "知识管理" : "内容工作流"],
      source_ids: sourceIds.slice(0, 3),
      blocks: [
        {
          id: randomUUID(),
          type: "paragraph",
          text: "一份资料，不必重复收集。让调研、写作与产物 Agent 围绕同一份知识协作，每次修改都有来处，每次输出都可追溯。",
          source_refs: [sourceIds[0]],
        },
        {
          id: randomUUID(),
          type: "callout",
          text: "示例内容 · 仅用于界面与交互验收。以下工作流描述不代表已连接任何外部账号。",
          source_refs: [],
        },
        {
          id: randomUUID(),
          type: "heading",
          level: 2,
          text: "1. 先存资料，再形成观点",
          source_refs: [],
        },
        {
          id: randomUUID(),
          type: "paragraph",
          text: "保存原文与快照，关联段落和来源。新的写作任务直接复用已有资料，而不是重新搜索一遍。内容版本和输出文件分别留存，让历史始终清晰。",
          source_refs: [sourceIds[1]],
        },
        {
          id: randomUUID(),
          type: "quote",
          text: "生成可以发生在不同工具里，资产应该留在同一个可信记录系统中。",
          attribution: "示例 · 工作流设计原则",
          source_refs: [],
        },
        {
          id: randomUUID(),
          type: "heading",
          level: 2,
          text: "2. 用明确的授权连接 Agent",
          source_refs: [],
        },
        {
          id: randomUUID(),
          type: "paragraph",
          text: "不同身份各自持有令牌，只访问获准项目。发生版本冲突时重新读取和比较，不直接覆盖其他 Agent 的修改。",
          source_refs: [sourceIds[2]],
        },
      ],
    });
    contentIds.push(result.id);
    const artifact = await write(`/api/contents/${result.id}/render`, {
      version: 1,
      kind: i % 2 ? "markdown" : "html",
      variant: i % 2 ? "general" : "web",
    });
    if (i < 2)
      await write("/api/publications", {
        artifact_id: artifact.id,
        platform: i ? "wechat" : "x",
        status: "published",
        url: `https://example.org/demo-publication/${i}`,
        note: "UI 验收示例，非实际外部发布。",
      });
  }
  const p = await write("/api/v1/projects", { name: "示例 · 研究空间" });
  await write("/api/v1/projects", { name: "示例 · 产品资料" });
  const specs = [
    {
      name: "示例 · 调研助手",
      scopes: [
        "sources:read",
        "sources:write",
        "contents:read",
        "changes:read",
      ],
    },
    {
      name: "示例 · 内容撰写助手",
      scopes: [
        "sources:read",
        "contents:read",
        "contents:write",
        "changes:read",
      ],
    },
    {
      name: "示例 · 产物整理助手",
      scopes: [
        "contents:read",
        "files:read",
        "files:write",
        "artifacts:read",
        "artifacts:write",
      ],
    },
    {
      name: "示例 · 只读审阅助手",
      scopes: ["sources:read", "contents:read", "artifacts:read"],
    },
  ];
  for (const [i, spec] of specs.entries()) {
    const a = await write("/api/v1/agents", {
      ...spec,
      project_ids: i === 0 ? ["default", p.data.id] : ["default"],
    });
    const token = await write(`/api/v1/agents/${a.data.id}/tokens`, {});
    const headers = { Authorization: `Bearer ${token.data.token}` };
    const response = await request.get(
      `/api/v1/contents/${contentIds[i]}?view=summary`,
      { headers },
    );
    expect(response.status()).toBe(200);
  }
  // Register real HTML bytes. CSP/sandbox must prevent both scripts and external tracking.
  const html =
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font-family:system-ui;padding:26px;background:#f3f7ef;color:#254132}small{color:#60825a;letter-spacing:2px}h1{font-size:29px;line-height:1.5}p{line-height:1.9;color:#56734c}.flow{padding:23px;border:1px solid #c7d9b7;border-radius:12px;background:white;margin-top:25px}</style><small>CONTENT HUB · 示例排版稿</small><h1>让知识流动，<br>让每份内容都有来处。</h1><p>跨 Agent 复用资料，将来源、正文和产物留在同一个数据中枢。</p><div class="flow">资料来源 → 正文版本 → 冻结产物</div><script>window.__studioInjected=true;top.__studioInjected=true</script><img src="https://example.org/blocked-tracker.png"></html>';
  const uploaded = await request.post("/api/v1/files?project_id=default", {
    headers: {
      Origin: baseURL!,
      "Content-Type": "text/html",
      "X-Filename": "studio-demo.html",
      "Idempotency-Key": "studio-upload-example",
    },
    data: Buffer.from(html),
  });
  expect(uploaded.status()).toBe(201);
  const file = await uploaded.json();
  const artifact = await write("/api/v1/artifacts", {
    content_id: contentIds[0],
    content_version: 1,
    file_id: file.data.id,
    kind: "html",
    variant: "studio-demo",
    recipe: { generator: "UI acceptance fixture" },
    idempotency_key: "studio-register-example",
  });
  selectedHtmlId = artifact.data.id;
});

test("approved studio direction renders live dashboard, sources, artifacts, access and editor", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await expect(page.locator(".overview-agents tbody tr")).toHaveCount(4);
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/studio-overview-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await nav(page, "信息源");
  await expect(
    page.getByRole("heading", { name: "资料采集中心", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".source-table tbody tr")).toHaveCount(6);
  await expect(page.locator(".source-excerpt")).toContainText("用于 UI 验收");
  await page.screenshot({
    path: "test-results/studio-sources-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await nav(page, "产物库");
  await expect(page.locator(".studio-html-preview")).toBeVisible();
  await expect(
    page
      .frameLocator(".studio-html-preview")
      .getByText("让知识流动", { exact: false }),
  ).toBeVisible();
  expect(await page.evaluate(() => "__studioInjected" in window)).toBe(false);
  await page.screenshot({
    path: "test-results/studio-artifacts-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await nav(page, "Agent 控制台");
  await expect(
    page.getByRole("heading", { name: "项目与权限管理", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".studio-agent-table .agent-card")).toHaveCount(4);
  await page.screenshot({
    path: "test-results/studio-agents-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await nav(page, "内容库");
  await page.getByRole("heading", { name: titles[0], exact: true }).click();
  await expect(page.getByLabel("内容标题")).toHaveValue(titles[0]);
  await page.getByRole("button", { name: "阅读预览", exact: true }).click();
  await page.screenshot({
    path: "test-results/studio-editor-desktop.png",
    fullPage: false,
    animations: "disabled",
  });
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("source filters, full-text detail, retry and related-content navigation are functional", async ({
  page,
}) => {
  await login(page);
  await nav(page, "信息源");
  await page.getByLabel("搜索来源", { exact: true }).fill("不存在的来源-xyz");
  await expect(
    page.getByText("没有符合筛选的来源", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await expect(page.locator(".source-table tbody tr")).toHaveCount(6);
  await page
    .locator(".studio-filter-tabs")
    .first()
    .getByRole("button", { name: /^网页链接/ })
    .click();
  await expect(page.locator(".source-table tbody tr")).toHaveCount(3);
  const detail = page.getByRole("complementary", { name: "来源详情" });
  await detail.getByRole("button", { name: "原文内容", exact: true }).click();
  await expect(page.locator(".studio-source-text")).toContainText(
    "登记记录并不代表自动发文",
  );
  await page
    .locator(".source-select")
    .filter({ hasText: "示例 · Agent 接入规范" })
    .click();
  await detail.getByRole("button", { name: "关联内容", exact: true }).click();
  await expect(detail.locator(".studio-related-row")).toHaveCount(6);
  await detail.getByRole("button", { name: new RegExp(titles[0]) }).click();
  await expect(page.getByLabel("内容标题")).toHaveValue(titles[0]);
  await nav(page, "信息源");
  await page.route(
    `**/api/sources/${sourceIds[4]}`,
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "测试：暂时不可用" }),
      }),
    { times: 1 },
  );
  await page
    .locator(".source-select")
    .filter({ hasText: "示例 · 开放接口参考" })
    .click();
  await expect(page.getByRole("alert")).toContainText("暂时不可用");
  await page.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(page.locator(".source-excerpt")).toContainText("UI 验收");
});

test("artifact filters, safe preview, real download and agent project filters work", async ({
  page,
}) => {
  await login(page);
  await nav(page, "产物库");
  await page.getByLabel("搜索产物", { exact: true }).fill("不存在的产物");
  await expect(
    page.getByText("没有符合筛选的产物", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "清除产物筛选", exact: true }).click();
  await expect(page.locator(".studio-artifact-card")).toHaveCount(7);
  await page.getByRole("button", { name: "生成配置", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "产物详情" }),
  ).toContainText("UI acceptance fixture");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载原文件", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toContain(".html");
  await nav(page, "Agent 控制台");
  await page
    .locator(".studio-project-card")
    .filter({ hasText: "示例 · 研究空间" })
    .click();
  await expect(page.locator(".studio-agent-table .agent-card")).toHaveCount(1);
  await expect(page.locator(".studio-agent-table")).toContainText(
    "示例 · 调研助手",
  );
  await page.getByRole("button", { name: "接入配置", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Agent 权限详情" }),
  ).toContainText("/api/v1/capabilities");
  await page.getByLabel("搜索 Agent", { exact: true }).fill("not-found");
  await expect(
    page.getByText("没有符合筛选的 Agent", { exact: true }),
  ).toBeVisible();
});

test("mobile master-detail views and keyboard navigation retain usable targets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/studio-overview-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Control+k");
  await expect(page.getByLabel("全局搜索", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "工作区导航" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "打开导航", exact: true }),
  ).toBeFocused();
  await nav(page, "信息源");
  await page.locator(".source-select").first().click();
  await expect(
    page.getByRole("button", { name: "返回来源列表", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".studio-browser-list")).toBeHidden();
  await expect(page.locator(".source-excerpt")).toContainText("UI 验收");
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/studio-source-detail-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "返回来源列表", exact: true }).click();
  await expect(page.locator(".studio-browser-list")).toBeVisible();
  await nav(page, "产物库");
  await page.locator(".artifact-select").first().click();
  await expect(page.locator(".studio-html-preview")).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/studio-artifact-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await nav(page, "Agent 控制台");
  const connect = page.getByRole("button", {
    name: "连接新 Agent",
    exact: true,
  });
  expect((await connect.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/studio-agents-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.locator(".studio-agent-table .studio-identity").first().click();
  await expect(
    page.getByRole("button", { name: "返回 Agent 列表", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
});
