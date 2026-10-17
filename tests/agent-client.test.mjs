import test from "node:test";
import assert from "node:assert/strict";
import { HubClient } from "../scripts/agent-client.mjs";
const options = {
  baseUrl: "http://localhost:3000",
  token: "synthetic-not-a-real-secret",
  sleep: async () => {},
};
const key = "stable-operation-01";
const write = {
  method: "POST",
  body: { project_id: "default", title: "fixture" },
  idempotencyKey: key,
};

test("lost write response retries identical bytes/key even if caller mutates the object", async () => {
  const body = { ...write.body },
    sent = [];
  const client = new HubClient({
    ...options,
    fetchImpl: async (_, init) => {
      sent.push(init);
      if (sent.length === 1) {
        body.title = "later edit";
        throw new TypeError("lost reply");
      }
      return Response.json({ data: { id: "one" }, meta: { replayed: true } });
    },
  });
  assert.equal(
    (await client.request("/contents", { ...write, body })).meta.replayed,
    true,
  );
  assert.equal(sent.length, 2);
  assert.equal(sent[0].body, sent[1].body);
  assert.equal(sent[1].headers["Idempotency-Key"], key);
  assert.equal(sent[1].redirect, "error");
});
test("version conflicts are returned without blindly rebasing or retrying", async () => {
  let calls = 0;
  const client = new HubClient({
    ...options,
    fetchImpl: async () => {
      calls++;
      return Response.json(
        {
          code: "VERSION_CONFLICT",
          detail: "Compare first.",
          retryable: false,
        },
        { status: 409 },
      );
    },
  });
  await assert.rejects(
    client.request("/contents/id/blocks", { ...write, method: "PATCH" }),
    (e) => e.code === "VERSION_CONFLICT",
  );
  assert.equal(calls, 1);
});
test("missing or inconsistent keys, remote cleartext and invalid attempt counts are rejected", async () => {
  assert.throws(
    () => new HubClient({ ...options, baseUrl: "http://remote.example" }),
    /HTTPS/,
  );
  assert.throws(
    () => new HubClient({ ...options, maxAttempts: NaN }),
    /maxAttempts/,
  );
  const c = new HubClient(options);
  await assert.rejects(
    c.request("/contents", { method: "POST", body: {} }),
    /idempotencyKey/,
  );
  await assert.rejects(
    c.request("/contents", {
      ...write,
      body: { idempotency_key: "different-key" },
    }),
    /agree/,
  );
  assert(!JSON.stringify(c).includes(options.token));
});
test("paths cannot escape API origin or traverse to legacy endpoints", async () => {
  const c = new HubClient(options);
  for (const path of [
    "//evil.example",
    "/../contents",
    "/%2e%2e/contents",
    "/\\evil",
    "/contents#x",
  ])
    await assert.rejects(c.request(path));
});
test("non-JSON gateway 502 is retried without losing write idempotency", async () => {
  let count = 0;
  const c = new HubClient({
    ...options,
    fetchImpl: async () =>
      ++count === 1
        ? new Response("bad gateway", { status: 502 })
        : Response.json({ data: "ok" }),
  });
  assert.equal((await c.request("/sources", write)).data, "ok");
  assert.equal(count, 2);
});
test("numeric Retry-After is respected", async () => {
  let count = 0;
  const waits = [];
  const c = new HubClient({
    ...options,
    sleep: async (ms) => {
      waits.push(ms);
    },
    fetchImpl: async () =>
      ++count === 1
        ? Response.json(
            { code: "RATE_LIMITED" },
            { status: 429, headers: { "Retry-After": "2" } },
          )
        : Response.json({ data: "ok" }),
  });
  await c.request("/capabilities");
  assert.deepEqual(waits, [2000]);
});
test("oversized server wait returns control instead of retrying too soon", async () => {
  let count = 0;
  const c = new HubClient({
    ...options,
    fetchImpl: async () => {
      count++;
      return Response.json(
        { code: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": "120" } },
      );
    },
  });
  await assert.rejects(
    c.request("/capabilities"),
    (e) => e.retryAfterMs === 120000,
  );
  assert.equal(count, 1);
});
test("caller cancellation prevents requests and bounded retry count prevents loops", async () => {
  let count = 0;
  const controller = new AbortController();
  controller.abort();
  const c = new HubClient({
    ...options,
    fetchImpl: async () => {
      count++;
      throw new TypeError("no reply");
    },
  });
  await assert.rejects(
    c.request("/capabilities", { signal: controller.signal }),
    (e) => e.code === "ABORTED",
  );
  assert.equal(count, 0);
  await assert.rejects(
    c.request("/contents", write),
    (e) => e.outcomeUnknown === true,
  );
  assert.equal(count, 3);
});
