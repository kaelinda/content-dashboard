# Content Hub 1.1.1 · 可靠性补丁与验收标准

## 本版基线

基于已合入的 1.1 主分支 `05b1968048094cfee88f3b43f0302bc3a60efdc8` 增量修复。保留现有十个 MCP 工具、REST 契约、细粒度 OAuth、项目和 Agent 模型、20 MiB 原文件上传。**不修改已执行的 001/002 SQL 迁移**，不以另一套同名迁移替换已有数据模型。

整体产品建议和已落实范围见 `V1_1_STANDARDS.md`；完整接口指南见 `AGENT_API.md`。本版不扩充任务编排和自动发文功能，优先处理实际失败和重试路径。

## 具体修复

| 场景                     | 处理方式                                                                | 验收要求                                                                |
| ------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Agent 写入响应丢失       | 执行器 helper 有限重试，重用逻辑幂等键及首次序列化的请求字节            | 调用者修改输入对象后，重试仍发送原快照；不会换 key 重复写入             |
| 409 版本冲突             | 返回问题详情，不自动重试或更换 expected_version                         | 客户端只执行一次请求；由 Agent 重新读取和比较                           |
| 429/临时 5xx             | 遵守 Retry-After，最多五次尝试，默认三次；超出等待预算交回执行器        | 不早于服务器要求重试，不无限循环；支持调用者取消                        |
| 上游返回 HTML 502        | 能识别非 JSON 临时失败并按同 key 重试                                   | 不因 JSON 解析异常丢失原写入语义                                        |
| 文本无法原样存储         | REST 与 MCP 共用文本检查，拒绝 NUL/孤立代理字符；HTTP 拒绝损坏 UTF-8    | 返回可修正 4xx，而非可重试 500；不静默替换字符                          |
| HTTP 参数歧义            | 拒绝重复查询参数、上传未知参数、JSON 写操作的无关 query、无效文件名编码 | 数据落库前明确报错；大小写及参数合法的 JSON MIME 仍接受                 |
| 网页保存响应丢失         | 当前编辑会话保留未确认请求；旧网页保存接口增加可选持久化幂等回执        | 首次创建只产生一个 ID；重试成功后保留之后的新输入，下一次保存才形成新版 |
| 正文已提交但列表刷新失败 | 独立反馈列表刷新问题，不报“保存失败”                                    | 正文仍显示已保存，刷新页面后数据正确                                    |
| 撤销区块删除             | 恢复时只保留仍关联的来源；切换历史版本清理旧撤销记录                    | 不恢复已经取消关联的引用，不混入其他版本的删除操作                      |

网页的未确认请求只在当前编辑会话内保留；这不是离线草稿、刷新后恢复队列或自动暂存。离开页面仍应留意未保存提示。Agent 长期运行时，执行器应持久化逻辑幂等键与原始输入，而不是依赖 helper 的进程内对象。

## 执行器客户端示例

无需安装额外 SDK，Node.js 22.16+ 可直接使用仓库中的 helper。令牌由执行器环境注入，不发给模型、不放正文和日志。

```js
import { HubClient } from "./scripts/agent-client.mjs";

const hub = new HubClient({
  baseUrl: process.env.HUB_URL,
  token: process.env.HUB_TOKEN,
});
const capabilities = await hub.request("/capabilities");
// 选择任务明确指定且获准的项目，而不是猜测任意项目 ID。
const project = capabilities.data.projects.find(
  (p) => p.id === process.env.HUB_PROJECT_ID,
);
if (!project) throw new Error("当前任务项目未获授权");

// logicalOperation 必须由执行器持久化；重新启动仍使用同一 key 和相同内容。
const logicalOperation = {
  key: "research-run-42-source-01",
  input: {
    project_id: project.id,
    title: "研究资料",
    markdown: "实际已取得的原文。",
  },
};
const receipt = await hub.request("/sources", {
  method: "POST",
  body: logicalOperation.input,
  idempotencyKey: logicalOperation.key,
});
console.log({ sourceId: receipt.data.id, replayed: receipt.meta.replayed });
```

`HubRequestError` 提供 `status`、`code`、`problem`、`outcomeUnknown`、`retryAfterMs`。`outcomeUnknown=true` 时不能把失败当作“没有提交”，应保留原请求按幂等规则恢复。helper 不处理二进制上传、OAuth 续期或自动权限扩大，也不会自动生成/更换幂等键。服务器重定向不会被跟随，远端连接要求 HTTPS；路径不能离开 `/api/v1/`。

## 验收层次

本版增加 6 项集成场景、8 项执行器客户端测试和 2 项真实浏览器场景。沿用 1.1 的原有测试，不删除失败用例、不把环境受阻记作通过。

- 领域测试：30 项。
- 数据库集成：原有 27 项 + Agent 38 项；分别在 PGlite 和外置 PostgreSQL 17 上运行。
- 客户端测试：8 项，验证同字节重试、冲突、等待预算、取消和传输边界。
- 浏览器：原有 4 项 + Agent 工作流 5 项，共 9 项。含真实 REST/MCP SDK 接力、文件字节核对、保存响应丢失后的实际去重，以及保存后列表刷新失败。
- TypeScript、生产构建、Docker Compose、私有接口拒绝匿名访问：继续作为合入检查。

这些是应执行的测试清单，不是仅凭本文声称已经通过。每次提交的实际结果和截图以对应 GitHub Actions 记录及 artifacts 为准。未进行第三方渗透测试或所有终端/屏幕阅读器兼容认证。

## 升级

已有安装先备份，停止旧应用并拉取 main，运行 `npm ci`、`npm run db:migrate`，再构建启动。保留 `.env.local`、`.data` 和对象存储数据。**不要重跑 setup，不要删除数据库，不要修改已执行迁移。** 本补丁没有新迁移；从 V1 升级时仍会执行 V1.1 已有的 002。

新的 Agent 接入仍需要实际运行的 Hub 地址及授权凭证。仓库代码和 CI 成功不等于用户公网服务器已部署，也不等于第三方 AI 产品账号已完成连接。
