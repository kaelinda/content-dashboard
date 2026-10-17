# 部署与运维

## 1. 本地单进程

`npm ci && npm run setup && npm run dev`。`setup` 不会覆盖现有 `.env.local`。运行入口会在缺少密码或配置无效时停止，并给出修复提示，不会开放数据。配置加载、doctor 与 Docker 初始化见 `ENVIRONMENT.md`。

默认 PGlite 与 Blob 都在 `.data/`。生产启动 `npm run build && npm start` 使用 standalone，但数据仍解析为项目根目录下的绝对路径。不要同时用开发服务、生产服务和迁移命令打开同一 PGlite 目录。要换端口，用 `npm start -- --port 3200`，同时把 `APP_URL` 改为相同的根地址。

项目默认只监听回环地址。需要受控网络访问时，先配置 HTTPS 和外部 PostgreSQL，随后设置 `HUB_HOST=0.0.0.0`；不要单纯开放 HTTP 端口再携带密码访问。

## 2. 服务器部署

建议 Linux + Docker Compose，使用仓库的 `Dockerfile` 与 `compose.yaml`。构建需要访问 npm；镜像使用 Node 22，运行进程为非 root 用户。

1. 全新安装运行 `npm run setup -- --docker`，妥善保存随机密码；已有配置不可重跑。
2. 在 `.env.local` 设置真实 `APP_URL=https://hub.your-domain.example`。
3. `setup --docker` 已生成随机 `POSTGRES_PASSWORD`。已有配置只在创建新数据库时补充随机十六进制密码，不要通过改文件误以为已轮换现有数据库密码。
4. `npm run doctor -- --compose` 后 `npm run docker:up`；独立 Docker 命令和 dotenv 语义区别见 `ENVIRONMENT.md`。
5. 使用现有 Caddy / Nginx / Tunnel 转发 HTTPS 到 `127.0.0.1:3000`，保留原始 Host / Origin。禁止日志记录 Authorization、Cookie 和请求体。
6. 检查 `/api/health`，再完成登录、导入、保存、下载和重启验证。

Caddy 示意配置（替换域名，先确认 DNS 与端口）：

```caddyfile
hub.your-domain.example {
    reverse_proxy 127.0.0.1:3000
}
```

Nginx 请求体限制建议 25 MiB（覆盖当前 20 MiB 原文件上限）、代理读取超时至少 120 秒。对外链抓取强烈建议再加基础设施出站策略：禁止 RFC1918、链路本地地址、云元数据地址和内部服务。应用内防护不是独立防火墙的替代。

生产数据库不要公开 5432；账号不能拥有你其他业务的数据库权限。当前自动迁移需要本项目 schema 的 DDL 权限。触发器约束能阻止正常 UPDATE/DELETE，但不能防范拥有 DDL 的恶意管理员；更高保证需分离 migration/runtime 角色并配置存储 Object Lock。

本地 PGlite 不支持两个应用进程共享目录；生产多实例必须使用外部 PostgreSQL 和对象存储。没有共享会话内存依赖，但浏览器/代理的实例数和 S3 客户端并发仍应按实际资源验证。

## 3. S3 兼容存储

```dotenv
STORAGE_DRIVER=s3
S3_ENDPOINT=https://your-s3-compatible-endpoint.example
S3_REGION=auto
S3_BUCKET=private-content-hub
S3_ACCESS_KEY_ID=仅此桶的访问身份
S3_SECRET_ACCESS_KEY=服务端秘密
```

AWS S3 可省略自定义 endpoint，填写正确 region；也可使用运行环境的凭证提供链。Bucket 必须私有，仅授予目标 bucket/prefix 的 GetObject / PutObject 权限，不需要 DeleteObject。供应商必须支持条件写入 `If-None-Match: *`。**S3/OSS/R2 的兼容性和 IAM 尚需用你的账户实测**；本地模式测试通过不代表每家对象存储已经联调。阿里云 OSS 不保证按本配置直接等价接入，应先核验其 S3 兼容能力或新增独立适配器。

逻辑 key 为 `blobs/sha256/<前两位>/<sha256>`。只有经过身份验证的服务端路径能取到字节；浏览器不持有 bucket 密钥、不把短时签名 URL 当内容本体。

切换存储前必须复制所有已有 Blob，并逐个核对 SHA-256。只改环境变量不会自动搬迁文件。

## 4. 备份与恢复

### 小型库

「连接与设置 → 导出完整备份」生成 JSON：包含关系数据、历史版本、Blob 原始字节，不包括账号密码、会话或 OAuth/API Token。二进制总量上限 50 MB，文件本身因 Base64 会更大。备份包含私有文章，请加密保存，不要提交 GitHub。

只恢复到新的空库；不要在现有内容上覆盖历史：

```bash
# 停止应用。给恢复副本使用新的 DATA_DIR，避免操作原库。
DATA_DIR=/absolute/path/to/restored-hub npm run restore -- /secure/path/backup.json
# 将服务 DATA_DIR 改为恢复目录后重新启动；登录凭证仍使用你的 .env.local。
```

使用外部数据库时也必须指向新的空数据库；`DATABASE_URL` 优先于 PGlite。恢复会验证所有 Blob 摘要及关联完整性，并在事务里锁表、再次检查目标为空。备份不会恢复任何授权，所以 Agent 需要重新连接。

### 较大生产库

先短暂停止应用写入，再备份 PostgreSQL 与全部 Blob（本地卷或对象存储），最后恢复应用。停止写入保证这两份备份的引用一致性：

```bash
docker compose --env-file .env.local stop app
docker compose --env-file .env.local exec -T db pg_dump -U content_hub -d content_hub -Fc > /secure/path/hub.dump
# 同时快照/归档 content_data 卷，或完成私有 Bucket 的版本化备份。
docker compose --env-file .env.local start app
```

不要只备份数据库，也不要只备份图片；两者共同构成资产。定期在空环境恢复演练。PGlite 目录备份必须在进程完全停止后做完整目录副本，不能运行 `pg_dump` 连接 WASM 引擎。

## 5. 密码和 Token 轮换

不要把明文密码写到数据库。生成新的随机密码与 scrypt 哈希可在独立临时目录运行 `node /项目绝对路径/scripts/setup.mjs`，把输出的 OWNER_PASSWORD_HASH 替换到生产 `.env.local` 后重启服务；不要覆盖其他环境配置。

密码哈希变更使旧网页登录会话立即失效。API/OAuth 令牌**不会因为网页登录密码变更而自动撤销**，需要在「连接与设置」逐一撤销；OAuth 同一家族会一并撤销。需要紧急全量撤销时，可由数据库管理员执行：

```sql
UPDATE tokens SET revoked_at=now() WHERE revoked_at IS NULL;
```

这会同时使当前会话失效。应用之后仍可通过新的工作区密码重新登录。

## 6. 运维检查

- `/api/health` 只说明进程和数据库可用，不证明 S3、平台发布或外部 MCP 客户端可用。
- 定期更新依赖，先在副本跑 `npm run check` 和浏览器测试，再部署。
- 已执行迁移有 checksum，禁止原地修改；新增迁移文件后部署。
- 监控磁盘空间、容器健康、数据库备份和证书。没有自动垃圾回收；不要手工删除未知 Blob。
- 日志只输出异常类型，避免把源文件或 Token 直接写进日志；进一步诊断应在受控环境复现。

## 7. 尚未配置的外部系统

代码没有使用你的服务器账号、飞书租户或发布凭证，也没有向任何社交平台发送内容。正式接入需要：服务器部署入口与 HTTPS、对象存储身份、凭证代理请求/响应协议、各平台发布权限及回调。不要通过文章字段或 MCP 工具传平台 app secret。
