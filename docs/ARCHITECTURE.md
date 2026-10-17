> V1.1 更新：多 Agent 的 REST/MCP 契约、项目隔离、显式 OAuth 写授权和兼容边界以 `docs/AGENT_API.md` 为准。下方保留 V1 的基础说明；旧客户端只读限制不代表新受限 Agent 只能读取。

# 架构与实现决策

## 数据流

```text
网页 / REST Agent ──身份校验──┐
                            ├─领域服务─事务─PostgreSQL
MCP Agent ──OAuth / Token───┘              │
                              原始快照 / WebP / 冻结输出
                                          ↓
                                  SHA-256 私有 Blob
```

Next.js 仅承担 UI、HTTP 和 OAuth/MCP 协议适配。`src/lib/domain.ts` 不依赖框架或数据库；`repository.ts` 维护事务与数据模型；`storage.ts` 封装私有内容寻址存储；`ingest.ts` 单独控制外网采集；`api.ts` 与 `/mcp` 复用同一领域服务。

## 为什么这样选

| 决策                  | 原因                                                        | 代价 / 换挡点                                  |
| --------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| Next.js Node Runtime  | 统一 UI 和 API，能够运行 PostgreSQL、Sharp 和 MCP SDK       | 不使用 Edge Runtime，长任务之后应独立 Worker   |
| PostgreSQL + 手写 SQL | 明确控制事务、版本外键、JSONB 和冻结触发器                  | 手写迁移必须接受真实数据库集成测试             |
| PGlite 本地模式       | 不用 Docker 即可体验，仍是 PostgreSQL 语义而非 localStorage | 单进程，不用于多实例或无持久磁盘环境           |
| 本地文件 / S3 适配    | 从低成本本地验证过渡到对象存储                              | S3 的兼容性、IAM 和备份需要部署时实测          |
| 轻量受控区块编辑器    | 精确保留来源、image_prompt 和 narration，不把 HTML 作为真相 | 尚未加入多人协作、富文本复制或大型编辑器生态   |
| 显式预注册 OAuth      | 限制到所有者批准的客户端；PKCE、资源受众、短期访问令牌      | 无公共动态注册，需从客户端获得真实回调地址     |
| 不加队列与 Redis      | 当前上传和生成有明确体积、时间上限，单用户可维护            | 视频、批量任务、定时同步需独立 Worker + outbox |

## 设计文档的落地修正

1. 原文「六张表」的 SQL 实际包含更多实体。这版为版本标题、快照位置、素材、来源版本关系与授权新增独立表，不为追求表数把不同职责混到一行。
2. 只读也需要认证。权限从第一天存在，不等写操作出现才引入。
3. 不采用「授权端点自动批准」。所有者必须登录并明确同意；回调严格匹配、S256 必需、authorization code 120 秒且单次使用。
4. OAuth access token 1 小时、refresh token 30 天并轮换；检测旧 refresh token 复用时撤销同一家族。API Token 独立于平台凭证，90 天，随时撤销。
5. Markdown 可以是**一个明确的冻结输出格式**，但不取代结构化正文。公众号排版稿和真正提交平台 API 的请求体不是一回事，因此不声称已保留最终平台字节。
6. 不把某个客户端或套餐当作架构硬编码。MCP 是协议入口；原文对 Groq/Grok 以及客户端套餐的描述需要按实际产品重新核验。
7. 不将只写触发器描述为绝对防篡改；数据库管理员、文件系统管理员依然属于信任边界。

## 表与不可变约束

- `sources`：原始字节摘要、规范化文本和元数据；原始摘要 / MIME / 抓取时间不可更新，原始行不可删除。
- `source_locations`：同一内容快照可能有多个 URL，不因全局字节去重丢掉地址。
- `assets` / `source_images`：素材与来源图片关联；图片入库转 WebP、保留尺寸、去元数据，禁止 SVG。
- `contents`：可变的当前标题、状态、标签、搜索文本和版本指针。
- `content_versions` / `content_blocks` / `content_sources`：每版本标题、区块和引用，不覆盖历史。历史来源关联不会随着当前版变化而漂移。
- `artifacts`：产物版本、recipe、字节摘要、大小，不允许 UPDATE / DELETE。
- `publications`：手动台账，必须绑定一个具体产物。修改正文不改写历史台账绑定。
- `events`：append-only 操作事件，不包含 token 原文。
- `tokens`：仅保存 SHA-256 哈希，种类区分 session/API/code/access/refresh，数据库索引和过期检查。
- `rate_limits`：数据库共享的频率窗口，避免仅靠单进程内存限制。

生成产物先写不可变 Blob，再插入带外键与摘要的数据库行。数据库失败可能留下无引用 Blob，但不会留下指向未写完文件的记录。暂不自动垃圾回收，避免误删历史资产。局部文件通过 fsync 后的原子 hard link 发布，重复上传不覆盖旧 Blob；读取重新计算摘要。

## 搜索与规模

全文检索初版采用参数化 `ILIKE`，可以直接匹配中文。它不是语义搜索。页面每批 100 条、MCP 检索最多 50 条；规模明显增长后应添加 pg_trgm / 文本检索索引与游标分页，再按需求评估向量索引。

## 官方技术参考

- Next.js 安装与 Node 运行环境：https://nextjs.org/docs/app/getting-started/installation
- Next.js 自托管：https://nextjs.org/docs/app/guides/self-hosting
- PGlite：https://pglite.dev/docs/
- MCP 授权规范：https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP TypeScript SDK：https://github.com/modelcontextprotocol/typescript-sdk

版本以仓库 `package-lock.json` 为准。升级前运行完整测试，不对依赖或客户端未来行为作静态保证。
