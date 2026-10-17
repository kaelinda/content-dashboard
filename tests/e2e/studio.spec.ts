import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const password = "Browser-acceptance-synthetic-password";
const refs: {
  source: string;
  content: string;
  artifact: string;
  agent: string;
  project: string;
} = { source: "", content: "", artifact: "", agent: "", project: "" };
async function json(
  r: APIRequestContext,
  path: string,
  data: unknown,
  origin: string,
) {
  const res = await r.post(path, { headers: { Origin: origin }, data });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("工作区密码").fill(password);
  await page.getByRole("button", { name: "进入工作台", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "让 Agent 协作，让数据有据。",
      exact: true,
    }),
  ).toBeVisible();
}
async function nav(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "打开导航", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: new RegExp("^" + name) })
    .click();
}
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const dismiss = page.getByRole("button", { name: "关闭提示", exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.screenshot({
    path: `test-results/studio-${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

test.beforeAll(async ({ request, baseURL }) => {
  const origin = baseURL!;
  await json(request, "/api/auth/login", { password }, origin);
  const sources = [];
  for (const [i, title] of [
    "示例 · 多 Agent 数据协作笔记",
    "示例 · 内容资产与版本设计",
    "示例 · API 接入与权限记录",
    "示例 · 绿色工作台界面规范",
    "示例 · 私有文件管理备忘",
  ].entries()) {
    const source = await json(
      request,
      "/api/sources",
      {
        title,
        markdown:
          title +
          "\n\n这是一份明确标记的演示资料，用于检查实际界面。\n\n资料原文、内容版本和输出文件应保持可追溯的关系。每个 Agent 使用独立身份和最小必要权限。来源已归档，不等于事实已核验。\n\n界面采用深绿导航与暖白工作区域，让内容与数据状态清晰可读。",
        url: i < 3 ? "https://example.org/reference-" + i : "",
        trust_level: i === 0 ? "high" : "medium",
      },
      origin,
    );
    sources.push(source);
  }
  refs.source = sources[0].id;
  const sharp = (await import("sharp")).default;
  const image = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="360"><defs><linearGradient id="g"><stop stop-color="#d2e8d7"/><stop offset="1" stop-color="#f4f8ef"/></linearGradient></defs><rect width="960" height="360" fill="url(#g)"/><path d="M0 360Q240 60 490 260T960 100V360" fill="#77a18b"/><path d="M0 360Q210 220 450 320T960 160V360" fill="#2e634c"/><circle cx="720" cy="110" r="45" fill="#fff" opacity=".7"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const img = await request.post("/api/assets", {
    headers: {
      Origin: origin,
      "Content-Type": "application/octet-stream",
      "X-Filename": "studio-example.png",
    },
    data: image,
  });
  expect(img.ok()).toBe(true);
  const asset = await img.json();
  for (const [i, title] of [
    "示例 · 让每份内容都有来处",
    "示例 · 从资料到分发版本",
    "示例 · Agent 接入与项目边界",
    "示例 · 可追溯的数据工作流",
  ].entries()) {
    const b = (type: string, text: string, extra = {}) => ({
      id: randomUUID(),
      type,
      text,
      source_refs: [],
      ...extra,
    });
    const content = await json(
      request,
      "/api/contents",
      {
        title,
        status: i === 1 ? "ready" : "draft",
        tags: ["示例数据", "知识管理"],
        source_ids: [sources[0].id, sources[1].id],
        blocks: [
          b(
            "callout",
            "这是一篇界面演示内容，不代表真实研究结论或平台发布结果。",
          ),
          b("heading", "一份数据，跨工具复用", { level: 2 }),
          b(
            "paragraph",
            "多个 Agent 围绕同一份资料接力工作。Hub 保存原始资料、结构化正文和实际输出，人通过工作台检查结果并纠正偏差。",
            { source_refs: [sources[0].id] },
          ),
          b("image", "示例 · 绿色层次与留白", { asset_id: asset.id }),
          b("quote", "真正值得保留的，不只是链接，还有当时的原始内容。", {
            attribution: "示例说明",
          }),
          b("heading", "明确边界，安全协作", { level: 2 }),
          b(
            "paragraph",
            "每次修改保留版本，所有写入检查权限。网络结果未知时，使用原幂等键重试，不覆盖其他执行器的新修改。",
          ),
        ],
      },
      origin,
    );
    const artifact = await json(
      request,
      `/api/contents/${content.id}/render`,
      { version: 1, kind: "html", variant: "web" },
      origin,
    );
    if (i === 0) {
      refs.content = content.id;
      refs.artifact = artifact.id;
    }
  }
  const project = await json(
    request,
    "/api/v1/projects",
    { name: "示例 · 产品设计" },
    origin,
  );
  refs.project = project.data.id;
  for (const [i, name] of [
    "示例 · 调研助手",
    "示例 · 内容写作助手",
    "示例 · 产物整理助手",
  ].entries()) {
    const agent = await json(
      request,
      "/api/v1/agents",
      {
        name,
        project_ids: i === 2 ? [refs.project] : ["default"],
        scopes:
          i === 0
            ? ["sources:read", "sources:write", "contents:read", "changes:read"]
            : ["contents:read", "artifacts:read", "changes:read"],
      },
      origin,
    );
    if (i === 0) {
      refs.agent = agent.data.id;
      const t = await json(
        request,
        `/api/v1/agents/${refs.agent}/tokens`,
        {},
        origin,
      );
      await request.get("/api/v1/contents/" + refs.content, {
        headers: { Authorization: "Bearer " + t.data.token },
      });
      await request.get("/api/v1/sources/" + refs.source, {
        headers: { Authorization: "Bearer " + t.data.token },
      });
    }
  }
  await json(
    request,
    "/api/publications",
    {
      artifact_id: refs.artifact,
      platform: "other",
      status: "draft",
      url: "",
      note: "示例登记；没有向外部发布",
    },
    origin,
  );
});

test("overview uses actual owner aggregates and keyboard search; anonymous/scoped access cannot read studio", async ({
  page,
  request,
  baseURL,
}) => {
  // Independent unauthenticated HTTP requests must not receive the owner-wide read model.
  const anonymous = await fetch(baseURL + "/api/studio");
  expect(anonymous.status).toBe(401);
  await login(page);
  const stats = await page.request.get("/api/studio");
  expect(stats.status()).toBe(200);
  const s = await stats.json();
  expect(s.counts.contents).toBeGreaterThanOrEqual(4);
  expect(s.counts.agents).toBe(3);
  expect(s.days).toHaveLength(7);
  await expect(
    page.locator(".studio-metric").filter({ hasText: "Agent 身份" }),
  ).toContainText("3");
  const token = (
    await json(
      page.request,
      `/api/v1/agents/${refs.agent}/tokens`,
      {},
      baseURL!,
    )
  ).data.token;
  expect(
    (
      await fetch(baseURL + "/api/studio", {
        headers: { Authorization: "Bearer " + token },
      })
    ).status,
  ).toBe(403);
  await page.keyboard.press("Control+k");
  await expect(page.getByLabel("全局搜索")).toBeFocused();
  await page.getByLabel("全局搜索").fill("多 Agent");
  await expect(page.locator(".search-results")).toContainText(
    "多 Agent 数据协作笔记",
  );
  await page.keyboard.press("Escape");
  await shot(page, "overview-desktop");
});

test("source explorer filters, loads actual citations, exports bytes and preserves original source", async ({
  page,
}) => {
  await login(page);
  await nav(page, "信息源");
  await page.getByLabel("搜索来源").fill("多 Agent");
  await expect(page.locator(".source-table tbody tr")).toHaveCount(1);
  await page.locator(".source-table").getByRole("button").click();
  const pane = page.getByRole("complementary", { name: "来源详情" });
  await expect(pane).toContainText("多 Agent 数据协作笔记");
  await pane.getByRole("button", { name: "关联内容", exact: true }).click();
  await expect(pane).toContainText("让每份内容都有来处");
  await pane.getByRole("button", { name: "原文", exact: true }).click();
  await expect(pane.locator(".studio-source-text")).toContainText(
    "这是一份明确标记的演示资料",
  );
  const dl = page.waitForEvent("download");
  await pane.getByRole("button", { name: "下载快照" }).click();
  expect((await readFile((await (await dl).path())!)).toString()).toContain(
    "这是一份明确标记",
  );
  await pane.getByRole("button", { name: "概览", exact: true }).click();
  await page.getByLabel("搜索来源").fill("");
  await shot(page, "sources-desktop");
  await page.getByRole("button", { name: "粘贴原文", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("来源标题")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "粘贴原文", exact: true }),
  ).toBeFocused();
});

test("artifact explorer safely previews actual files and binds publication to selected artifact", async ({
  page,
}) => {
  await login(page);
  await nav(page, "产物库");
  await page.getByLabel("搜索产物").fill("让每份内容");
  await page.locator(".artifact-select").click();
  const pane = page.getByRole("complementary", { name: "产物详情" });
  await expect(pane.locator("iframe")).toHaveAttribute("sandbox", "");
  await expect(
    pane
      .frameLocator("iframe")
      .getByText("这是一篇界面演示内容", { exact: false }),
  ).toBeVisible();
  await pane.getByRole("button", { name: "生成记录", exact: true }).click();
  await expect(pane.locator("pre.studio-json")).toContainText("html");
  await pane.getByRole("button", { name: "基本信息", exact: true }).click();
  await page.getByLabel("搜索产物").fill("");
  await shot(page, "artifacts-desktop");
  await pane.getByRole("button", { name: "登记发布", exact: true }).click();
  await expect(
    page.getByRole("dialog").locator('select[name="artifact_id"]'),
  ).toHaveValue(refs.artifact);
  await page.keyboard.press("Escape");
});

test("project and agent selection reflect actual permissions; diagnostic details do not invent traces", async ({
  page,
}) => {
  await login(page);
  await nav(page, "Agent 控制台");
  await page
    .locator(".studio-project-options")
    .getByRole("button", { name: /示例 · 产品设计/ })
    .click();
  await expect(page.locator(".studio-grants-table tbody tr")).toHaveCount(1);
  await page
    .locator(".studio-grants-table")
    .getByRole("button", { name: /产物整理助手/ })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Agent 权限详情" }),
  ).toContainText("示例 · 产品设计");
  await page
    .locator(".studio-project-options")
    .getByRole("button", { name: /全部项目/ })
    .click();
  await page.getByLabel("搜索 Agent").fill("调研");
  await page
    .locator(".studio-grants-table")
    .getByRole("button", { name: /调研助手/ })
    .click();
  await page.getByLabel("搜索 Agent").fill("");
  await shot(page, "agents-desktop");
  await page.locator(".agent-table").getByRole("button").first().click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("调用诊断");
  await expect(page.getByRole("dialog")).toContainText("不包含请求正文");
  await page.keyboard.press("Escape");
});

test("editor reference layout supports reading sources, focus mode and real historical comparison", async ({
  page,
}) => {
  await login(page);
  await page.goto("/?content=" + refs.content);
  await expect(page.getByLabel("内容标题")).toHaveValue(
    "示例 · 让每份内容都有来处",
  );
  await page.getByRole("button", { name: "阅读预览", exact: true }).click();
  await shot(page, "editor-desktop");
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  await expect(page.locator(".editor-inspector")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator(".editor-inspector")).toBeVisible();
  await page.getByRole("button", { name: "版本历史", exact: true }).click();
  await page.getByRole("button", { name: "对比", exact: true }).first().click();
  await expect(
    page.getByRole("dialog").locator(".article-preview"),
  ).toHaveCount(2);
  await page.keyboard.press("Escape");
});

test("all redesigned pages reflow at phone/tablet widths; mobile navigation traps focus and closes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  for (const [label, title] of [
    ["工作台", "让 Agent 协作，让数据有据。"],
    ["信息源", "资料采集中心"],
    ["产物库", "产物与发布中心"],
    ["Agent 控制台", "项目与权限管理"],
    ["内容库", "内容库"],
  ]) {
    await nav(page, label);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      label,
    ).toBe(true);
    await shot(
      page,
      label === "Agent 控制台"
        ? "agents-mobile"
        : label === "工作台"
          ? "overview-mobile"
          : label === "信息源"
            ? "sources-mobile"
            : label === "产物库"
              ? "artifacts-mobile"
              : "library-mobile",
    );
  }
  const menu = page.getByRole("button", { name: "打开导航", exact: true });
  await menu.click();
  await expect(page.locator(".main-shell")).toHaveJSProperty("inert", true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(menu).toBeFocused();
  await page.setViewportSize({ width: 1024, height: 900 });
  await nav(page, "Agent 控制台");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await shot(page, "agents-tablet");
});
