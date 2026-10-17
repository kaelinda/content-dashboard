import { test, expect, type Page } from "@playwright/test";
const password = "Browser-acceptance-synthetic-password";
async function login(page: Page) {
    await page.goto("/");
    await page.getByLabel("工作区密码").fill(password);
    await page.getByRole("button", { name: "进入工作台" }).click();
    await expect(page.getByRole("heading", { name: "让 Agent 协作，让数据有据。" })).toBeVisible();
    await page.goto("/?view=settings");
    await expect(page.getByRole("heading", { name: "安全与登录会话" })).toBeVisible();
    await expect(page.getByText("当前登录", { exact: true })).toBeVisible();
}
async function confirm(page: Page, value = password) {
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("当前工作区密码").fill(value);
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "验证密码并执行" }).click();
}
test("owner diagnoses service and revokes another session only after password verification", async ({ page, request, baseURL }) => {
    await login(page);
    const other = await request.post("/api/auth/login", { headers: { Origin: baseURL! }, data: { password } });
    expect(other.ok()).toBe(true);
    await page.getByRole("button", { name: "刷新会话" }).click();
    await expect(page.getByText("其他网页登录", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "退出其他网页登录", exact: true }).click();
    await confirm(page, "not-the-password");
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("密码不正确");
    expect((await request.get("/api/security")).status()).toBe(200);
    await confirm(page);
    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect((await request.get("/api/security")).status()).toBe(401);
    expect((await page.request.get("/api/security")).status()).toBe(200);
    await page.getByRole("button", { name: "检查服务" }).click();
    await expect(page.getByText("尚未验证", { exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/operations-security-desktop.png", fullPage: true });
});
test("bulk Agent revocation blocks live API access without deleting data or owner session", async ({ page, request, baseURL }) => {
    await login(page);
    const a = await page.request.post("/api/v1/agents", { headers: { Origin: baseURL! }, data: { name: "示例 · 运维验收 Agent", scopes: ["contents:read"], project_ids: ["default"] } });
    expect(a.ok()).toBe(true);
    const agent = (await a.json()).data;
    const t = await page.request.post(`/api/v1/agents/${agent.id}/tokens`, { headers: { Origin: baseURL! }, data: {} });
    expect(t.ok()).toBe(true);
    const token = (await t.json()).data.token;
    expect((await request.get("/api/v1/capabilities", { headers: { Authorization: "Bearer " + token } })).status()).toBe(200);
    await page.getByRole("button", { name: "停用全部 Agent 访问", exact: true }).click();
    await confirm(page);
    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect((await request.get("/api/v1/capabilities", { headers: { Authorization: "Bearer " + token } })).status()).toBe(401);
    const state = await page.request.get("/api/security");
    expect(state.status()).toBe(200);
    expect((await state.json()).counts.authorized_agents).toBe(0);
});
test("mobile safety controls fit and emergency revocation logs the owner out", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "紧急撤销全部访问", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: "test-results/operations-security-mobile.png", fullPage: true });
    await confirm(page);
    await expect(page.getByLabel("工作区密码")).toBeVisible();
    expect((await page.request.get("/api/security")).status()).toBe(401);
});
