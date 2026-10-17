import test from "node:test";
import assert from "node:assert/strict";
import { HubClient } from "../scripts/agent-client.mjs";
test("client retries a lost write response with the exact same key and bytes", async () => {
  const sent = [];
  const client = new HubClient({
    baseUrl: "http://localhost:3000",
    token: "synthetic",
    fetchImpl: async (url, init) => {
      sent.push(init);
      if (sent.length === 1) throw new TypeError("Synthetic lost response");
      return Response.json({ data: { id: "one" }, meta: { replayed: true } });
    },
  });
  const r = await client.request("/sources", {
    method: "POST",
    body: { project_id: "default", title: "Fixture", markdown: "x" },
    idempotencyKey: "persisted-operation-01",
  });
  assert.equal(r.meta.replayed, true);
  assert.equal(sent.length, 2);
  assert.equal(
    sent[0].headers["Idempotency-Key"],
    sent[1].headers["Idempotency-Key"],
  );
  assert.equal(sent[0].body, sent[1].body);
});
test("client never blindly retries a version conflict", async () => {
  let calls = 0;
  const client = new HubClient({
    baseUrl: "http://localhost:3000",
    token: "synthetic",
    fetchImpl: async () => {
      calls++;
      return Response.json(
        { code: "VERSION_CONFLICT", detail: "Read and compare." },
        { status: 409 },
      );
    },
  });
  await assert.rejects(
    client.request("/contents/x/blocks", {
      method: "PATCH",
      body: {},
      idempotencyKey: "conflict-operation-01",
    }),
    (e) => e.code === "VERSION_CONFLICT",
  );
  assert.equal(calls, 1);
});
test("client rejects missing idempotency and remote cleartext transport", async () => {
  assert.throws(
    () =>
      new HubClient({ baseUrl: "http://remote.example", token: "synthetic" }),
    /HTTPS/,
  );
  const c = new HubClient({
    baseUrl: "http://localhost:3000",
    token: "synthetic",
  });
  await assert.rejects(
    c.request("/contents", { method: "POST", body: {} }),
    /idempotencyKey/,
  );
});
