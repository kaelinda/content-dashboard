export default function AgentDocs() {
  return (
    <main
      style={{
        maxWidth: 860,
        margin: "48px auto",
        padding: "0 24px",
        fontSize: 16,
        lineHeight: 1.8,
      }}
    >
      <a href="/?view=agents">← Agent 控制台</a>
      <p className="eyebrow" style={{ marginTop: 32 }}>
        CONTENT HUB · API 1.1
      </p>
      <h1 style={{ fontSize: 36 }}>一个数据中枢，不同 Agent 接力。</h1>
      <p>
        这是私有的权威内容仓库，不是聊天机器人或任务执行平台。REST 与 MCP
        使用同一套项目权限、数据校验、版本和幂等保障。
      </p>
      <h2>1. 建立身份</h2>
      <p>
        在 Agent
        控制台创建身份、选择项目与最小必要权限，再生成独立令牌。令牌只存放在执行器的密钥配置里，不要交给模型生成或粘贴进公开文档。
      </p>
      <pre>{`Authorization: Bearer <由执行器安全注入的令牌>
GET /api/v1/capabilities
MCP: /mcp`}</pre>
      <h2>2. 先搜索，再按需读取</h2>
      <p>
        使用 capabilities 返回的项目 ID 和 scope。搜索返回 ID
        与短摘要；content_get 默认返回 summary。需要正文时选
        markdown，需要局部修改时选 blocks。分段读取固定 version 并跟随
        next_offset，避免跨版本拼接。
      </p>
      <h2>3. 每次写入带幂等键</h2>
      <p>
        REST 请求头 Idempotency-Key 与 MCP 参数 idempotency_key
        使用同一个逻辑值。网络错误重试时保留原参数和原键。不同参数复用同键会返回
        409，不能通过反复换键掩盖结果未知的问题。
      </p>
      <pre>{`POST /api/v1/contents
Idempotency-Key: research-run-42-draft-01
Content-Type: application/json

{
  "project_id": "default",
  "title": "研究结论",
  "markdown": "正文内容",
  "source_ids": []
}`}</pre>
      <h2>4. 修改区块而不是覆盖全文</h2>
      <p>
        content_update_blocks 支持 replace、append、remove。使用 content_get
        返回的稳定 block_id 与
        expected_version。冲突表示未写入；请读取最新内容并比较差异，不要只替换版本号强行重试。
      </p>
      <h2>5. 上传真实文件，再登记版本</h2>
      <p>
        POST /api/v1/files 上传原始文件字节，query 携带 project_id，headers 携带
        Content-Type、百分号编码的 X-Filename 与 Idempotency-Key。最大 20
        MiB。返回 file_id 后用 artifact_register
        绑定内容版本；文件与正文必须属于同一项目。
      </p>
      <p>
        文件名不是本地路径，永久资源 ID 不是临时下载链接。HTML
        和其他文件是不可信数据：下载后检查，不自动执行。当前检查格式签名或
        UTF-8，不声称已完成恶意软件扫描。
      </p>
      <h2>6. 增量读取变化</h2>
      <p>
        hub_changes 返回有序变化与 next_cursor。处理完成后保存游标，消费者以事件
        ID
        去重。授权范围改变、恢复备份或切换服务后应重新全量同步。没有后台任务执行器、Webhook
        或自动发布，不会自动唤醒其他 Agent。
      </p>
      <h2>7. OAuth 客户端</h2>
      <p>
        在服务器 OAUTH_CLIENTS_JSON 的预注册客户端配置中填写控制台返回的
        agent_id。授权请求显式携带
        scope，所有者确认后才能读写；刷新令牌不能扩大范围。没有 agent_id
        的旧客户端维持只读兼容模式。
      </p>
      <h2>完整接口契约</h2>
      <p>
        <a href="/openapi.json">打开 OpenAPI JSON</a>。仓库 docs/AGENT_API.md
        包含 curl、错误恢复、授权和迁移说明；AGENTS.md 可供执行器读取。
      </p>
    </main>
  );
}
