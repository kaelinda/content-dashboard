# Content Hub · 内容中枢

**让每一次创作，都有来处，也有去处。**

面向多个 AI Agent 的私有内容数据中枢，并为所有者提供核查与纠错工作台。基于 **Next.js App Router + React + TypeScript + PostgreSQL**，把分散的信息来源、结构化正文、派生产物和发布记录串在一起。不是静态页面，也不依赖浏览器 localStorage 保存正文。

```text
信息源与原始快照 → 结构化正文 @版本 → 不可变产物 → 发布台账
                       ↑                 ↓
                   网页 / REST       下载 / 私有 MCP
```

## V1.1 · Agent-first 升级

**Agent 生产和使用数据，Hub 保存版本与授权，人通过网页检查和纠错。**

新增 `/api/v1`、按 scope 开放的 MCP 写工具、共享输入/输出 Schema 与 OpenAPI、稳定 Agent 身份和项目隔离、事务性幂等回执、区块级并发更新、外部原始文件上传与产物登记、增量变化及 Agent 控制台。

首次接入：网页登录 → **Agent 控制台** → 创建身份/项目授权 → 生成令牌 → 查询 `/api/v1/capabilities`。文档：网页 `/docs/agents`、仓库 [AGENT_API.md](docs/AGENT_API.md)；已落实与未落实的标准见 [V1_1_STANDARDS.md](docs/V1_1_STANDARDS.md)。

升级前先备份，执行 `npm ci` 与 `npm run db:migrate`，不要删除 `.data`。原数据保留在默认项目。新增项目后，旧全库 Bearer token 不再允许使用旧 `/api` 接口；请更换受限 Agent token。OAuth 只有显式配置 Agent 身份并审批 scope 后才允许写入，旧客户端不会自动升级。

不包含后台任务执行器、Webhook、自动发文或真实第三方账号联调。文件格式验证不是恶意软件扫描。

## 启动使用

需要 Node.js **22.16+**（建议 Node 22 LTS），首次安装依赖需要联网。

```bash
git clone https://github.com/kaelinda/content-dashboard.git
cd content-dashboard
npm ci
npm run setup
npm run dev
```

打开 **http://localhost:3000**。`setup` 会在终端**只显示一次随机工作区密码**，请存入密码管理器；`.env.local` 只保存密码的 scrypt 哈希，不存在默认密码、游客登录或公开内容接口。

首次登录可以创建自己的内容，也可以主动点击 **「导入示例」**。示例数据有明确标记，不会被自动发布。正常数据位于 `.data/`，停止再启动后仍然保留。

正式运行：

```bash
npm run build
npm start
```

生产启动脚本运行 Next.js standalone 服务，开发与生产默认使用同一 `.data/` 路径。**不要同时启动两个 PGlite 进程操作同一目录。**

## 已有功能

| 模块       | 可执行的操作                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------- |
| 私有工作台 | 密码登录、会话退出、真实资产计数、最近内容、来源和操作流水                                      |
| 信息源     | HTTPS 链接采集、粘贴文本、HTML/Markdown/TXT/PDF 文件归档、SHA-256 去重、原始快照下载            |
| 内容编辑器 | 标题、段落、引用、代码、提示、图片、配图提示词、口播 8 类区块；来源关联、标签、状态、阅读预览   |
| 版本历史   | 每次保存新增版本，保留历史标题/正文/引用；载入旧版创建新版；并发修改冲突提示                    |
| 素材库     | 图片上传、重编码 WebP、去除元数据、尺寸记录、正文复用、私有下载                                 |
| 产物库     | HTML 页面、公众号排版稿、Markdown、配图提示词 JSON、分镜 JSON；确定性渲染、摘要去重、冻结和下载 |
| 发布台账   | 手动记录对应产物、平台、状态和原文链接；明确区分「登记」和「真正发布」                          |
| Agent 接入 | 带权限的 REST API Token；按权限开放 MCP 读写；旧令牌兼容 `search` / `fetch` / `list_contents`   |
| 授权       | 所有者显式同意、预注册客户端、OAuth 授权码 + PKCE S256、受众验证、refresh token 轮换和复用撤销  |
| 备份       | 小型库 V2 导出项目/数据/原始文件与幂等回执；恢复身份默认停用，不导出登录凭证                    |

网页集合默认加载最近 100 条，提供加载更多；全局搜索检索正文和来源，不只搜索当前页。PDF **只留存原始字节，不含 OCR/正文抽取**。来源图片采集最多 5 张，失败会明确记录告警。

## 技术选择

- **Next.js 16.4.2 / React 19.3.1 / TypeScript**：App Router 和 Node.js Route Handlers；UI 与领域服务分离。
- **PostgreSQL**：SQL 迁移、JSONB 区块、显式事务、乐观并发控制。`DATABASE_URL` 指定正式数据库。
- **PGlite**：本地单进程使用的 PostgreSQL WASM 实现，真实持久化、沿用同一 SQL；省去本地安装 Docker 的前置步骤。不是生产多实例数据库。
- **内容寻址存储**：默认私有本地文件；可切到 S3 兼容存储（例如 R2）。文件的 key 只由服务端 SHA-256 计算。
- **Cheerio + Sharp**：HTML 正文提取、图片安全重编码。采集时 DNS/IP 验证、连接地址固定、逐次重定向检查和大小限制。
- **官方 MCP TypeScript SDK**：实现实际协议协商与工具调用，不用自造的 JSON 接口冒充 MCP。
- **Node Test + Playwright + GitHub Actions**：领域、数据库/授权集成、真实浏览器流程测试。

采用明确 SQL，而非额外引入 ORM：本项目的版本、冻结和审计约束需要直接表达，单用户 MVP 不需要再叠加 Redis、向量数据库、任务编排系统或微服务。

## 部署

本地无需云账号。正式服务器建议 **Docker Compose + PostgreSQL + 私有对象存储/挂载磁盘 + HTTPS 反向代理**：

```bash
npm run setup  # 已有 .env.local 时不重复执行
# 在 .env.local 设置 APP_URL=https://你的域名
# 添加 POSTGRES_PASSWORD=<openssl rand -hex 24 生成的随机值>
docker compose --env-file .env.local up -d --build
```

Compose 只把应用端口绑定到服务器 `127.0.0.1:3000`，数据库不暴露公网。由现有 HTTPS 反向代理转发到应用；设置请求体上限至少 12 MB，超时至少 120 秒。

**不能把默认 PGlite / 本地文件模式直接放到临时文件系统的 Serverless 实例。** 多实例要配置外部 PostgreSQL 和 S3。部署、迁移、恢复和凭证轮换见 [运维说明](docs/OPERATIONS.md)。

## 自动化接入

网页登录「连接与设置」创建令牌。令牌仅创建时展示一次，默认只读，90 天有效；写令牌不能管理其他令牌或导出完整备份。平台 app secret 从未通过 UI/MCP 暴露。

```bash
export HUB_TOKEN='在网页创建的令牌，不要写入仓库'
curl http://localhost:3000/api/contents -H "Authorization: Bearer $HUB_TOKEN"
```

[MCP、OAuth 和 REST 使用说明](docs/CONNECTING.md) · [架构与设计修正](docs/ARCHITECTURE.md)

## 测试

```bash
npm run typecheck
npm test
npm run test:integration
npm run build
npx playwright install chromium
npm run test:e2e
```

集成测试使用临时数据库，不访问你的内容。浏览器测试使用 `.data-e2e/`，会在每次测试开始时清理这个**专用测试目录**，请勿在其中保存个人资料。GitHub Actions 保存浏览器报告和截图。

## 明确边界

这版已经实现「收集 → 写作 → 版本 → 生成 → 下载 → 登记」闭环，但不把以下项目标成完成：

- **外部平台自动发文未启用**：需要你的凭证服务器 API 契约、域名和平台授权；现有发布页只做人工台账，绝不会假装发布成功。
- **飞书单向同步未接入**：不读取、不修改你已有的飞书系统，也不把它当权威存储。
- **不生成实际 AI 图片/视频**：已支持素材管理和配图提示词/分镜导出，未接推理/图像/视频计费服务。
- **真实客户端联调需实际账号**：MCP/OAuth 协议有自动化测试；ChatGPT、豆包、WorkBuddy 的连接界面、权限及计划限制以实际客户端为准。
- **没有假公网地址**：仓库和部署文件不等于已上线；需在真实服务器运行后才有可访问的私人站点。

## 安全说明

仓库是源代码，不是内容存储。不要提交 `.env.local`、数据库、备份、令牌或任何平台密钥。所有用户数据接口需要认证；来源内容永远视为不可信文本。不可变历史由数据库触发器与应用路径共同保护，但管理员仍能修改底层数据库，不等于合规 WORM 或第三方存证。

安全边界、测试范围与限制见 [SECURITY.md](SECURITY.md)。
