# 环境配置、初始化与启动自检（1.1.2）

此版继续把 Hub 作为多 Agent 的权威数据中枢，只完善配置与启动入口，不改变 REST/MCP 契约、权限模型或 001/002 数据库迁移。

## 推荐：维护根目录的 .env.local

```text
content-dashboard/
  .env.example       # 安全模板，不填真实秘密、不当作运行配置
  .env.local         # 私有实际配置，不提交 Git
  package.json
```

本机与原生服务器命令现统一使用 Next.js 自己的 `@next/env` 解析器，不再混用 `process.loadEnvFile`。优先级从高到低为：进程环境 → `.env.<mode>.local` → `.env.local` → `.env.<mode>` → `.env`。test 模式跳过 `.env.local`。`.env` 现在同样可以读取，但不要复制出两份容易漂移的实际配置；本项目仍推荐 `.env.local`。不支持把配置放进 `src/`。

`npm run dev` 使用 development；`npm run build`、`npm start`、`doctor` 和 Docker 启动助手使用 production。迁移/恢复默认 production，可用 `NODE_ENV=development` 选择开发配置。存在其他模式文件时，先核对 `doctor` 输出的来源顺序，避免迁移命令连接到与预期不同的数据库。外部注入变量优先（包含显式空值）；空数据库地址表示 PGlite。

Next.js 会展开 `$VARIABLE`，包括引号内的值。需要字面 `$` 时在环境文件中写 `\$`，复杂秘密建议由部署系统直接注入进程环境。配置不得有循环变量引用。修改配置后重启服务。

## 首次本机安装

```bash
npm ci
npm run setup
npm run doctor
npm run dev
```

`setup` 创建权限为 0600 的 `.env.local`，生成随机登录密码，并只将 scrypt 哈希写入配置。默认密码只在终端显示一次。它不创建数据库、不写业务数据，也不覆盖现有 `.env*` 文件或进程中的登录凭证。已有安装不要删除配置来强行重跑。

也可以将初始密码直接写入一个新的私有文件，避免出现在终端日志中：

```bash
npm run setup -- --password-output /安全目录/initial-password.txt
```

输出文件不可已存在；生成后存入密码管理器并妥善处理该文件。该选项不把密码当命令行参数；不要把密码文件加入 Git。Windows 的权限由系统 ACL 决定，需要另行确认。

## 已有安装升级

先备份并停止旧应用，再执行：

```bash
git pull --ff-only
npm ci
npm run doctor
npm run db:migrate
npm run build
npm start
```

保留 `.env.local`、`.data` 和存储中的原文件。本补丁无新迁移；从 V1 升级仍会应用既有的 002。不要同时运行两个 PGlite 进程；包括开发、生产、迁移和恢复。`doctor` 不打开数据库，可以在服务运行时做配置格式检查。

## 自检命令

```bash
npm run doctor
npm run doctor -- --mode development
npm run doctor -- --compose
npm run --silent doctor -- --json
```

检查站点根地址、密码哈希、数据库地址、数据目录、存储方式、S3 配对凭证和 endpoint、OAuth JSON/唯一客户端/精确回调，以及端口、监听地址和误用 `NEXT_PUBLIC_` 的私密字段。只显示字段名、错误码及修复说明，不输出变量值、连接串、密码、哈希、OAuth 内容或云密钥。

错误退出码为 1；仅警告时可为 0。JSON 返回 `ok`、`checks`、`sources`、`networkChecked:false`、`dataModified:false`，便于执行器判断。配置格式正确不等于数据库、S3、域名、证书或第三方 Agent 已联通；此命令没有网络探测、迁移或数据写入。不要用它的绿色结果当作上线验收。

运行时缺少必要配置会在服务监听、迁移或恢复前停止。生产构建不需要初始化登录密码或访问服务；已有但错误的配置仍会报错。请使用仓库提供的 npm 启动命令和 Docker 入口，不绕过它们直接运行 Next CLI 或 standalone 的 server.js。

## 常用变量

| 变量                                        | 行为                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `APP_URL`                                   | 用户和 Agent 实际访问的站点根地址；远程必须 HTTPS，无用户名、密码、子路径、query 或 fragment。本机默认 `http://localhost:3000` |
| `OWNER_PASSWORD_HASH`                       | setup 生成的 scrypt 哈希，不是明文密码                                                                                         |
| `HUB_HOST` / `PORT`                         | 原生 Node 的监听地址/端口；默认 `127.0.0.1` / `3000`。监听地址不等于外部访问地址                                               |
| `DATABASE_URL`                              | 留空使用单进程 PGlite；否则填写 PostgreSQL 连接串，特殊密码字符需 URL 编码                                                     |
| `DATA_DIR`                                  | 默认 `.data`；禁止项目根、public 和 .next 目录，仍需部署方保证文件权限                                                         |
| `STORAGE_DRIVER`                            | 只能为 `local` 或 `s3`，拼写错误不会悄悄落到另一个存储                                                                         |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET`   | 自定义 endpoint 使用 HTTPS，本机测试可 HTTP；直连 AWS S3 时填真实 region 而非 auto                                             |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | 成对设置，或都留空由 AWS SDK 在运行环境中取得凭证                                                                              |
| `S3_SESSION_TOKEN`                          | 使用显式 S3 临时密钥时可选的会话令牌                                                                                           |
| `OAUTH_CLIENTS_JSON`                        | 不用 OAuth 时 `[]`；客户端 id 唯一，回调精确注册，写权限仍需 Agent 绑定与显式同意                                              |
| `POSTGRES_PASSWORD`                         | Compose 专用的随机十六进制密码，不是网页登录密码，不是 Agent token                                                             |

远端用反向代理时 `APP_URL` 可以是 HTTPS 443，而内部监听端口仍是 3000。没有代理的本机测试，访问地址和监听端口应一致；localhost 和 127.0.0.1 也是不同 Origin。`npm start -- --port 3200` 不自动改写 `APP_URL`。

## Docker Compose

全新安装可以一次生成独立的数据库密码：

```bash
npm ci
npm run setup -- --docker --url https://你的真实域名
npm run doctor -- --compose
npm run docker:up
```

`docker:up` 用相同的 Next.js 解析器加载 production 环境，再通过显式字段列表向 Compose 注入；app 不再把 `.env.local` 的任意变量整份带入容器。Docker 镜像不含实际 `.env` 文件，也不把构建成功当作运行时配置正确。

模板会覆盖应用的 `DATABASE_URL` 为容器 PostgreSQL，`DATA_DIR=/app/.data`，内部监听 3000；宿主映射始终为 `127.0.0.1:${PORT:-3000}`。`HUB_HOST` 不会将 Docker 宿主端口公开。原生 AWS 环境凭证/角色挂载不自动继承，使用显式 S3 凭证或在部署层配置容器身份。

没有在主机安装 npm 依赖时仍可使用 `docker compose --env-file .env.local up -d --build`；这是 Docker 自己的 dotenv/interpolation 语义，并非 Next.js 解析器。含 `$` 的复杂值要特别核对，推荐 npm 启动助手或明确的进程注入。容器入口仍会执行配置校验，但不会读取本机其他模式文件。

已有 `.env.local` 不要重跑 setup；只在创建全新 Compose 数据库时为其补充随机十六进制 `POSTGRES_PASSWORD`。有数据卷的 PostgreSQL 不会因修改环境文件而自动轮换密码，需要用数据库自身流程处理。部署前停止旧实例、备份并准备真实 HTTPS 反向代理；这里不会替你配置域名、证书或服务器。

## Agent 配置与服务端配置分开

Hub 的 `.env.local` 是服务端配置。各个 Agent 的执行器另外维护 `HUB_URL`、`HUB_TOKEN`、`HUB_PROJECT_ID`，不要把它们混成网页登录密码或注入模型提示词。接入后先调用 `/api/v1/capabilities`；更多说明见 `AGENT_API.md`。OAuth 的配置格式校验不查询数据库，因此不能证明配置中的 Agent ID 已存在或获准写入。

## 参考与验证范围

解析规则以 Next.js 官方环境变量文档为依据：
https://nextjs.org/docs/app/guides/environment-variables

直接调用 Compose 的变量规则：
https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/

新增配置测试覆盖解析优先级、test 隔离、美元符号转义、脱敏、首次初始化/已有文件保护、Compose 密码及各启动入口的提前失败。原有数据库、HTTP/MCP SDK、浏览器和 Docker 测试保留，实际通过情况以当前提交的 CI 为准。没有进行真实云账号、VPS 或所有操作系统的联调认证。

## 1.2.1 运行迁移模式

`HUB_MIGRATIONS=auto` 保留兼容行为；`verify` 仅校验已执行迁移的名称和字节摘要，不执行 DDL。迁移使用独立维护进程的 DATABASE_URL 执行 `npm run db:migrate`；运行进程不接收迁移凭证。Compose 转发该变量但不自动建立分离角色，完整流程见 OPERATIONS_HARDENING.md。
