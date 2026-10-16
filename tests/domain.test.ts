import test from "node:test";
import assert from "node:assert/strict";
import {
  parseContent,
  renderContent,
  escapeHtml,
  isPublicIPv4,
  validateFetchUrl,
  safeReturnTo,
  isStale,
} from "../src/lib/domain.ts";
const input = () => ({
  title: "测试文章",
  status: "draft",
  tags: ["测试"],
  source_ids: ["source-1"],
  blocks: [
    {
      id: "block-1",
      type: "paragraph",
      text: "正文",
      source_refs: ["source-1"],
    },
  ],
});
test("structured content and references survive validation", () => {
  assert.equal(parseContent(input()).blocks[0].source_refs[0], "source-1");
});
test("rejects references not linked to this version", () => {
  const c = input();
  c.source_ids = [];
  assert.throws(() => parseContent(c), /当前版本/);
});
test("rejects duplicate blocks", () => {
  const c = input();
  c.blocks.push(c.blocks[0]);
  assert.throws(() => parseContent(c), /不能重复/);
});
test("rejects unknown block type and invalid version", () => {
  assert.throws(() =>
    parseContent({ ...input(), blocks: [{ id: "x", type: "script" }] }),
  );
  assert.throws(() => parseContent({ ...input(), expected_version: 0 }));
});
test("HTML escapes executable content and title", () => {
  const c = parseContent({
    ...input(),
    title: "<script>alert(1)</script>",
    blocks: [
      {
        id: "x",
        type: "paragraph",
        text: "<img src=x onerror=alert(1)>",
        source_refs: [],
      },
    ],
  });
  const r = renderContent(c, "html", "web");
  assert.ok(!r.body.includes("<script>"));
  assert.ok(!r.body.includes("<img src=x"));
  assert.match(r.body, /&lt;script&gt;/);
  assert.match(r.body, /form-action 'none'/);
});
test("HTML renders deterministically", () => {
  const c = parseContent(input());
  assert.deepEqual(
    renderContent(c, "html", "web"),
    renderContent(c, "html", "web"),
  );
});
test("narration and image prompts do not leak into text output", () => {
  const c = parseContent({
    ...input(),
    blocks: [
      ...input().blocks,
      { id: "voice", type: "narration", text: "口播内容", source_refs: [] },
      {
        id: "prompt",
        type: "image_prompt",
        text: "图片提示词",
        source_refs: [],
      },
    ],
  });
  assert.ok(!renderContent(c, "html", "web").body.includes("口播内容"));
  assert.match(renderContent(c, "json", "storyboard").body, /口播内容/);
  assert.match(renderContent(c, "json", "image-prompts").body, /图片提示词/);
});
test("Markdown code fence safely contains embedded fences", () => {
  const c = parseContent({
    ...input(),
    blocks: [{ id: "code", type: "code", text: "```\nhello", source_refs: [] }],
  });
  assert.match(renderContent(c, "markdown", "general").body, /````/);
});
for (const ip of [
  "127.0.0.1",
  "10.1.1.1",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.0.1",
  "169.254.169.254",
  "100.64.0.1",
  "0.0.0.0",
  "224.1.1.1",
  "198.18.0.1",
  "192.0.2.1",
  "::1",
  "::ffff:127.0.0.1",
  "999.1.1.1",
])
  test(`blocks SSRF address ${ip}`, () =>
    assert.equal(isPublicIPv4(ip), false));
test("permits public IPv4", () =>
  assert.equal(isPublicIPv4("93.184.216.34"), true));
for (const url of [
  "http://example.com",
  "https://user:secret@example.com",
  "https://example.com:8443",
  "https://localhost",
  "file:///etc/passwd",
])
  test(`rejects unsafe fetch URL ${url}`, () =>
    assert.throws(() => validateFetchUrl(url)));
test("safe redirects reject protocol-relative and backslash URLs", () => {
  assert.equal(safeReturnTo("//evil.com"), "/");
  assert.equal(safeReturnTo("/\\evil.com"), "/");
  assert.equal(
    safeReturnTo("/oauth/authorize?state=a"),
    "/oauth/authorize?state=a",
  );
});
test("escaping and stale version rules", () => {
  assert.equal(escapeHtml("<&\"'"), "&lt;&amp;&quot;&#39;");
  assert.equal(isStale(1, 2), true);
  assert.equal(isStale(2, 2), false);
});
