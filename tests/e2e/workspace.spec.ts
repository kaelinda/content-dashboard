import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const password = "Browser-acceptance-synthetic-password";
const evidence = "test-results";
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("工作区密码").fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(
    page.getByRole("heading", { name: "好内容，从这里发生。" }),
  ).toBeVisible();
}
async function nav(page: Page, name: string) {
  // A navigation badge contributes its count to the accessible button name.
  const label = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const button = page.getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: new RegExp("^" + label + "(?:\\s+\\d+)?$") });
  await expect(button).toBeVisible();
  await button.click();
}
test.describe("Real creator workflows", () => {
  test("owner can log in and create clearly labelled demonstration data", async ({ page, request }) => {
    expect((await request.get("/api/contents")).status()).toBe(401);
    await page.goto("/");
    await page.screenshot({ path: evidence + "/login.png", fullPage: true });
    await login(page);
    await page.getByRole("button", { name: "导入示例", exact: true }).click();
    await expect(page.getByRole("heading", {
      name: "示例 · 把灵感变成可复用的内容资产", exact: true,
    })).toBeVisible();
    await page.screenshot({ path: evidence + "/dashboard.png", fullPage: true });
  });
  test("source → structured draft → frozen artifact → new revision → publication record", async ({ page }) => {
    await login(page);
    await nav(page, "信息源");
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByRole("button", { name: "粘贴原文" }).click();
    await page.getByRole("dialog").locator('input[name="title"]').fill("浏览器验收 · 来源");
    await page.getByRole("dialog").locator('textarea[name="markdown"]').fill("完整正文来自实际保存的来源。事实需要可回溯的证据。");
    await page.getByRole("dialog").getByRole("button", { name: /保存/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await nav(page, "内容库");
    await page.getByRole("button", { name: "新建内容", exact: true }).first().click();
    await page.getByLabel("内容标题").fill("浏览器验收 · 第一份内容");
    await page.getByLabel("区块 1 正文").fill("从来源到输出，验证真实持久化。<script>window.__injected=1</script>");
    await page.getByLabel("标签", { exact: true }).fill("测试, 知识管理");
    await page.locator(".source-checks").getByRole("checkbox", { name: /浏览器验收 · 来源/ }).check();
    await page.getByRole("button", { name: "保存内容", exact: true }).click();
    await expect(page.getByText("已保存 · v1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "阅读预览", exact: true }).click();
    await expect(page.locator(".article-preview")).toContainText("<script>window.__injected=1</script>");
    expect(await page.evaluate(() => "__injected" in window)).toBe(false);
    await page.screenshot({ path: evidence + "/editor.png", fullPage: true });
    await expect(page).toHaveURL(/\?content=/);
    await page.reload();
    await expect(page.getByLabel("内容标题")).toHaveValue("浏览器验收 · 第一份内容");
    await page.getByRole("button", { name: "生成产物", exact: true }).click();
    await page.getByRole("button", { name: "生成并冻结" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载产物" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.html$/);
    const bytes = await readFile((await download.path())!);
    expect(bytes.toString()).toContain("&lt;script&gt;");
    const hash = createHash("sha256").update(bytes).digest("hex");
    await expect(page.locator(".hash-box")).toContainText(hash);
    await page.getByRole("dialog").getByRole("button", { name: "关闭弹窗", exact: true }).click();
    await page.getByLabel("内容标题").fill("浏览器验收 · 第二版标题");
    await page.getByRole("button", { name: "保存内容", exact: true }).click();
    await expect(page.getByText("已保存 · v2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "版本历史", exact: true }).click();
    await expect(page.locator(".version-item")).toHaveCount(2);
    await expect(page.locator(".version-list")).toContainText("浏览器验收 · 第一份内容");
    await page.locator(".version-item").last().getByRole("button", { name: "载入编辑" }).click();
    await expect(page.getByLabel("内容标题")).toHaveValue("浏览器验收 · 第一份内容");
    await page.getByRole("button", { name: "保存内容", exact: true }).click();
    await expect(page.getByText("已保存 · v3", { exact: true })).toBeVisible();
    await nav(page, "产物库");
    const item = page.locator(".artifact-card").filter({ hasText: "浏览器验收 · 第一份内容" });
    await expect(item).toContainText("正文已有新版本");
    await item.getByRole("button", { name: "记录发布" }).click();
    await page.getByRole("dialog").locator('select[name="platform"]').selectOption("x");
    await page.getByRole("dialog").getByLabel("状态", { exact: true }).selectOption("published");
    await page.getByRole("dialog").locator('input[name="url"]').fill("https://example.com/manual-test-publication");
    await page.getByRole("dialog").getByRole("button", { name: "保存记录", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await nav(page, "发布记录");
    await expect(page.getByRole("link", { name: "查看原文" })).toHaveAttribute("href", "https://example.com/manual-test-publication");
  });
  test("uploaded images can be reused in a content block", async ({ page }) => {
    await login(page);
    await nav(page, "素材库");
    const sharp = (await import("sharp")).default;
    const buffer = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#bed4c6" } }).png().toBuffer();
    await page.locator('input[type="file"]').setInputFiles({ name: "acceptance-image.png", mimeType: "image/png", buffer });
    await expect(page.locator(".asset-card").filter({ hasText: "acceptance-image.png" })).toBeVisible();
    await nav(page, "内容库");
    await page.getByRole("button", { name: "新建内容", exact: true }).first().click();
    await page.getByLabel("内容标题").fill("浏览器验收 · 有图的内容");
    const select = page.getByLabel("插入已有素材");
    const option = await select.locator("option").filter({ hasText: "acceptance-image.png" }).getAttribute("value");
    await select.selectOption(option!);
    await expect(page.locator(".editor-image img")).toBeVisible();
    await page.getByRole("button", { name: "保存内容", exact: true }).click();
    await expect(page.getByText("已保存 · v1", { exact: true })).toBeVisible();
  });
  test("mobile workspace navigation stays inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: evidence + "/mobile.png", fullPage: true });
    await page.getByRole("button", { name: /打开导航|菜单|展开导航/ }).click();
    await nav(page, "信息源");
    await expect(page.getByRole("heading", { name: "信息源", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
