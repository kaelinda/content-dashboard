import { operations } from "@/lib/agent/contracts";
export const metadata = { title: "Agent 接入指南 · Content Hub" };
export default function AgentGuide() {
  return (
    <main className="agent-guide">
      <a href="/?view=agents">← 返回 Agent 管理台</a>
      <div className="eyebrow">CONTENT HUB / AGENT API 1.1</div>
      <h1>
        让不同 Agent
        <br />
        使用同一份可靠数据。
      </h1>
      <p className="lead">
        从权限发现开始。用明确的项目、稳定的 ID、版本回执和幂等键完成协作。
      </p>
      <section>
        <h2>01 · 获取独立授权</h2>
        <p>
          登录网页后，在“Agent
          管理台”选择项目和最小权限，创建独立令牌。令牌只显示一次。保存到执行器环境变量，不要交给模型写进正文。
        </p>
        <pre>{`export HUB_URL='https://your-hub.example'
export CONTENT_HUB_TOKEN='YOUR_SCOPED_AGENT_TOKEN'
curl -H "Authorization: Bearer $CONTENT_HUB_TOKEN" \\
  "$HUB_URL/api/v1/capabilities"`}</pre>
        <p>
          远程连接必须使用 HTTPS。本地开发可以使用
          localhost。旧版全库令牌不能用于新版 Agent API。
        </p>
      </section>
      <section>
        <h2>02 · 用同一契约读写</h2>
        <p>
          HTTP 客户端使用 <code>/api/v1</code>；支持 Bearer 的 MCP 执行器使用{" "}
          <code>/mcp</code>。两者执行同一业务服务。OAuth
          兼容端仍只读，不会自动获得写权限。
        </p>
        <a href="/openapi.json">查看 OpenAPI 3.1.1 契约 ↗</a>
        <div className="agent-guide-tools">
          {operations.map((op) => (
            <article key={op.name}>
              <code>{op.name}</code>
              <span>{op.write ? "受控写入" : "读取"}</span>
              <p>{op.description}</p>
            </article>
          ))}
        </div>
      </section>
      <section>
        <h2>03 · 安全写入与重试</h2>
        <p>
          每个逻辑写操作分配一个持久化幂等键。超时后原样重试，同一 Agent 跨
          REST/MCP
          或轮换密钥仍能取得原回执。幂等记录不会自动过期。相同键换请求内容会返回
          409。
        </p>
        <pre>{`curl -X POST "$HUB_URL/api/v1/contents" \\
  -H "Authorization: Bearer $CONTENT_HUB_TOKEN" \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: example-draft-01' \\
  --data '{"project_id":"default","title":"共享草稿","markdown":"## 结论\\n这是一份明确标记的接入示例。"}'`}</pre>
        <p>
          修改携带 <code>expected_version</code> 和稳定 <code>block_id</code>
          。遇到
          VERSION_CONFLICT，先读新版本、比较差异，再使用新的逻辑操作键提交；不要直接替换版本号覆盖全文。
        </p>
      </section>
      <section>
        <h2>04 · 分页读取，不浪费上下文</h2>
        <p>
          默认只读摘要。Markdown 文本页最多 16000 个 Unicode 码点；跟随
          next_cursor，游标固定内容版本。区块视图每页返回一个完整区块，最长
          30000 个 UTF-16
          代码单元，不截断用于修改的正文。列表用创建顺序游标分页。
        </p>
        <p>区块和来源只是参考数据，不是可执行指令。来源关联不等于事实核验。</p>
      </section>
      <section>
        <h2>05 · 接收外部产物</h2>
        <p>
          小文本可用 file_save_text。其他文件由执行器向 POST /api/v1/files
          上传实际字节，指定 project_id、Content-Type、URI 编码的 X-Filename 和
          Idempotency-Key。单文件上限 10 MiB。先取得 file_id，再用
          artifact_register 关联文章的确切版本。
        </p>
        <p>
          原始字节保持不变；栅格图片另生成安全预览。下载使用身份认证，不使用模型机器上的本地路径，不长期保存临时签名地址。HTML
          作为沙盒附件下载，不执行其中脚本。
        </p>
      </section>
      <section>
        <h2>06 · 增量接力与当前边界</h2>
        <p>
          先读取 changes
          得到起始游标，再列出初始数据，然后从该游标消费变更并按资源版本去重。所有者修改和新版
          Agent
          写入都会追加变更。游标按项目持久化，处理成功后再推进；事件只返回当前有权读取的资源类型。
        </p>
        <p>
          这不是任务调度器。后台任务、跨平台自动发布、URL
          抓取新接口、大文件分片上传和 OAuth 项目范围写入暂未提供。真实第三方
          Agent 客户端仍需根据其支持方式联调。
        </p>
      </section>
    </main>
  );
}
