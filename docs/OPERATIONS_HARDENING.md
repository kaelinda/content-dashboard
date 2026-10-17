# V1.2.1 · 可诊断、可撤销、可恢复

## 本轮范围

基于 V1.2 Sage Studio 的 `a304180` 增量加固。仍是单所有者私有数据中枢；Agent 生产和消费数据，Hub 保留版本、不可变产物、权限与回执。不是自动流水线或多租户改造。

不修改已应用的 001/002 迁移，不新增迁移，不改十个 Agent 工具的业务输入/输出，不替换已确认的深绿/暖白 UI。新增安全与诊断卡片放在“连接与设置”。

## 限流

限流窗口和剩余等待时间从 PostgreSQL/PGlite 时钟计算。限流错误附 `Retry-After` 秒数：新版 REST 的 `retry_after_seconds`、旧 REST 错误和 MCP 的 HTTP 拒绝响应使用同一计算来源；工具内遇到同类业务错误也保留恢复字段。

客户端仍应有限重试并保留原幂等键。409 不自动重试。该实现仍是固定窗口限流；不是滑动窗口或按消费计费系统。

## 安全管理

`GET /api/security` 仅接受所有者登录会话，返回最多 100 个当前密码指纹下的有效会话，注明截断；不返回 token 明文、hash 或 meta。凭证计数包含 API/code/access/refresh 多种记录，不等于连接数或在线 Agent 数。

`POST /api/security/revoke` 仅限所有者会话、同源请求、严格 JSON，并重新验证当前密码。操作类型：

| action | 影响 |
|---|---|
| session + token_id | 仅撤销该网页登录会话，不能借此操作 Agent token |
| other_sessions | 保留当前会话，退出其他网页登录，不撤销 Agent |
| agent_access | 停用全部 Agent，撤销全部 API/OAuth 凭证（含授权码、访问和刷新令牌），保留网页登录 |
| all_access | 停用 Agent，撤销所有凭证，当前会话也退出 |

所有撤销及其审计事件在同一事务提交，表锁使先前的凭证修改先完成。重新验证密码的限流按整个工作区计数，换会话不能重置。界面要求勾选影响确认，不提供无后端支撑的开关。

撤销针对之后的认证，不撤回已开始执行的请求或已经提交的内容；也不是禁用登录入口。怀疑密码泄露时必须另外轮换服务器密码。密码变更使旧网页登录指纹失效，但不会自动撤销 API/OAuth，日常改密和应急撤销故意分开。恢复 Agent 访问需要所有者重新批准并签发新令牌，旧令牌不会因重新启用身份复活。

撤销响应丢失时不要盲目重发“全部撤销”，先刷新列表或重新登录确认，避免影响随后新授权的访问。密码仅在当前表单提交，结束后清空，不进入 localStorage 或日志。未加入 2FA 或独立安全认证。

## 健康检查与日志

| 入口 | 身份与语义 |
|---|---|
| GET /api/health/live | 公开，仅返回进程可响应，不打开数据库 |
| GET /api/health/ready | 公开，仅 `{ok}`；数据库与迁移字节一致性，失败 503 |
| GET /api/health | 保持原入口，使用同一就绪语义 |
| GET /api/health/diagnostics | 仅网页登录所有者，增加一个已有 Blob 元信息读取检查 |

就绪检查成功缓存 10 秒、失败 3 秒；单个响应等待上限 2.5 秒，同一进程只保留一个底层检查在途。数据库连接/语句仍有原有超时。存储诊断缓存 30 秒，S3 单次元信息探测 5 秒；空库显示未验证，不生成 canary 或误报已联通。外部存储故障不与进程存活混为一谈。

存储抽样只证明一个已有对象的元信息可读，不证明写权限、全量字节完整性或恢复能力。诊断不返回连接串、路径、Bucket、密钥或数据库原始异常。首次自动模式连接仍沿用原初始化/迁移行为；生产只读迁移模式见下方。

HTTP 日志覆盖网页 API、Agent API、MCP、OAuth token 请求，包括上传/下载的成功或失败响应：白名单 JSON 字段仅含时间、服务器生成的 request_id、路由模板、方法、状态、耗时与已认证主体标识，不记录资源标题、文件名、任意 URL/query、请求/响应正文、Cookie、Authorization 或异常消息。Agent 操作另有结构化结果与 replayed，用于计算调用延迟、失败率和重放率。MCP 工具 ID 和父 HTTP request_id 分开，允许关联。

日志事件叫 `http.response_prepared`：它不证明客户端已经接收了全部文件字节。stdout 收集、保留/加密、聚合与告警需部署方配置；本版没有 Prometheus/OTEL 看板，也不能从 Hub 推算未上报消费者的 change lag。日志故障不把已经成功的写入改成失败响应。网关仍应禁止记录请求体和敏感头。

## 只读文件对账

```bash
# PGlite 必须先停止服务；外部 PG 可用只读维护身份在独立进程运行。
npm run storage:reconcile
npm run storage:reconcile -- --verify
```

只校验、只输出 JSON，不修复、不删除。数据库连接强制 verify 迁移模式；引用快照使用只读 REPEATABLE READ 事务。检查 sources/assets/artifacts/agent_files 的去重摘要，区分缺失、不可读和字节 SHA-256 不匹配；没有 `--verify` 时仅核对元信息。完整性校验采用顺序流式读取，单文件上限 64 MiB。

默认最多 1000 个引用/清单项，引用检查预算 60 秒（清单另有最多 60 秒预算）；预算在操作之间检查，S3 请求和返回体读取各有 10 秒超时，返回头不代表文件读取完成。超过上限、部分读取或无法列目录会明确 `complete:false`，不宣称全库检查通过。只在引用集完整时报告疑似孤儿，文件必须早于快照至少 24 小时；新文件视为可能仍在写入，不列为候选。

“疑似孤儿”不是删除许可：并发事务可能在快照之后引用该对象，必须停止写入后再核对并人工决定。未知文件名和临时文件只计数，不跟随内部文件符号链接。S3 清单需专用维护身份的 `ListBucket`，常规运行凭证仍不需要 DeleteObject；没有清单权限时标注不完整。尚未使用用户真实 S3/OSS/R2 账号验收。

退出码 0 表示完成且没有缺失/不匹配/读取错误，2 表示异常或不完整，1 表示配置/执行失败。输出包含对象摘要，也属于私有运维资料，应妥善保存。

## 迁移与运行账号分离（可选生产模式）

新增 `HUB_MIGRATIONS=auto|verify`。auto 为兼容默认；verify 只比较磁盘迁移名/摘要和数据库 schema_migrations，版本缺失、漂移或数据库比代码更新时拒绝启动数据库服务，不执行 CREATE/ALTER，也不把未知版本当兼容。

部署流程：停止旧写入并备份 → 使用 migration 账号和真实目标库运行 `npm run db:migrate` → 按新迁移重新审核运行授权 → 给应用注入 runtime DATABASE_URL 和 `HUB_MIGRATIONS=verify` → 启动并验收。

`db:migrate` 是明确的维护命令，会执行迁移，不受运行模式 verify 限制；它使用该进程的 DATABASE_URL，不读取另一个隐藏的迁移密钥。迁移凭证不要注入应用进程。

`ops/runtime-grants.sql` 提供已存在的独立运行角色授权模板，用 psql 的 schema/runtime_role 变量指定**专用 Hub schema**。角色不得是 superuser、表/schema owner，也不能继承迁移角色。模板不创建登录密码、不自动改现有角色、不撤销其历史额外权限；部署方需检查既有成员关系/权限。显式授予业务所需读写和序列权限，不授予历史修改、DDL、schema_migrations 写入或 TRUNCATE。恢复使用维护账号进入空库，不使用 runtime 账号强行恢复。

```bash
# 在 DBA 已创建角色且连接到正确专用库后执行；不要把密码放命令行。
psql -v ON_ERROR_STOP=1 -v schema=public -v runtime_role=hub_runtime -f ops/runtime-grants.sql
```

现有 Compose 保留原单账号易启动配置，转发 HUB_MIGRATIONS，但**不会自动创建分离账号**。独立 PostgreSQL 角色测试在隔离的 TEST_DATABASE_URL 上运行，不作用于用户数据库。

## 依赖与交付门禁

Dependabot 每周为 npm 与 GitHub Actions 提出更新 PR，不自动合并。Dependency security audit 在 PR、main push、手动及每周运行：生产依赖 high/critical 阻断；包含开发依赖的 critical 阻断。扫描不可用属于失败，不当作零漏洞；没有自动 audit fix --force，没有无期限忽略清单。

原有 check 与 13 个浏览器场景保留；新增运维/恢复测试和 3 个真实安全界面场景。PostgreSQL 测试额外验证运行角色能读写业务而不能 CREATE/ALTER/改历史/篡改迁移。

测试使用合成内容，在临时目录/隔离 schema 验证版本、原文件、空库恢复和恢复后 Agent 停用，不读取用户真实配置或私有备份。测试成功不等于渗透测试、S3 实测或用户 VPS 已部署。每个提交的实际通过数以对应 CI 为准。

## 升级与暂缓

已有安装备份、停服务后：`git pull --ff-only`、`npm ci`、`npm run doctor`、`npm run db:migrate`、`npm run build`、`npm start`。保留 .env.local/.data，不重跑 setup。此补丁无新迁移，现有 Agent 接入不需要重新配置；只有主动执行撤销操作才会停用访问。

暂缓：nonce-only CSP、2FA、完整监控平台、全局变更时钟替换/压测认证、自动 GC、后台 Worker/Webhook、真实模型生成、自动发布及 SaaS。外部发布的恰好一次语义不能由 Hub 的本地幂等承诺代替。

参考：RFC 9110 §10.2.3 Retry-After；OWASP Logging Cheat Sheet（不记录访问令牌/会话标识原文）；GitHub Dependabot options reference。这里是工程实现范围，不是独立安全审计报告。
