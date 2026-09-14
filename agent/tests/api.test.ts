import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import type { ChatResult } from "../src/agent.js";
import type { AllowanceStatus } from "../src/sui.js";

async function start(t: TestContext, chat: (history: import("../src/agent.js").ChatTurn[], message: string, provider?: import("../src/ai-config.js").AIProvider) => Promise<ChatResult> = async () => ({ reply: "ok", toolCalls: [], payments: [] })) {
  const app = createApp({
    runChat: chat, getAllowanceStatus: async () => ({} as AllowanceStatus), listActivity: () => [],
    executePayment: async () => { throw new Error("Unexpected payment"); }, agentAddress: () => "agent",
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
function post(base: string, path: string, body: unknown, headers = {}) {
  return fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}
test("owner signing endpoints have been removed", async (t) => {
  const base = await start(t);
  for (const path of ["/api/owner/pause", "/api/owner/limits"]) assert.equal((await post(base, path, {})).status, 404);
});
test("cross-site requests and hostile Host headers cannot reach payment handlers", async (t) => {
  let calls = 0;
  const base = await start(t, async () => { calls++; return { reply: "ok", toolCalls: [], payments: [] }; });
  const body = { requestId: crypto.randomUUID(), message: "lunch" };
  assert.equal((await post(base, "/api/chat", body, { Origin: "https://evil.example" })).status, 403);
  const hostStatus = await new Promise<number>((resolve, reject) => {
    // Node fetch replaces Host; use raw HTTP to actually send the adversarial header.
    const req = httpRequest(base + "/api/chat", { method: "POST", headers: { Host: "evil.example", "Content-Type": "application/json" } }, (res) => {
      res.resume(); res.on("end", () => resolve(res.statusCode!));
    });
    req.on("error", reject); req.end(JSON.stringify(body));
  });
  assert.equal(hostStatus, 403);
  assert.equal(calls, 0);
});
test("invalid messages and attack names fail before execution", async (t) => {
  const base = await start(t);
  assert.equal((await post(base, "/api/chat", { requestId: crypto.randomUUID(), message: 5 })).status, 400);
  assert.equal((await post(base, "/api/attack/toString", { requestId: crypto.randomUUID() })).status, 404);
});
test("replayed requests return their receipt without executing again", async (t) => {
  let calls = 0;
  const base = await start(t, async () => { calls++; return { reply: "ok", toolCalls: [], payments: [] }; });
  const body = { requestId: crypto.randomUUID(), message: "lunch" };
  assert.equal((await post(base, "/api/chat", body)).status, 200);
  assert.equal((await post(base, "/api/chat", body)).status, 200);
  assert.equal(calls, 1);
  assert.equal((await post(base, "/api/chat", { ...body, message: "different" })).status, 409);
});
test("overlapping payment requests are not executed concurrently", async (t) => {
  let release!: () => void;
  let started!: () => void;
  const begun = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const base = await start(t, async () => { started(); await gate; return { reply: "ok", toolCalls: [], payments: [] }; });
  const first = post(base, "/api/chat", { requestId: crypto.randomUUID(), message: "lunch" });
  await begun;
  try {
    assert.equal((await post(base, "/api/chat", { requestId: crypto.randomUUID(), message: "another lunch" })).status, 409);
  } finally { release(); }
  assert.equal((await first).status, 200);
});

test("provider selection is validated, forwarded, and included in replay protection", async (t) => {
  const selected: string[] = [];
  const base = await start(t, async (_history, _message, provider) => {
    selected.push(provider!); return { reply: "ok", toolCalls: [], payments: [], provider };
  });
  const body = { requestId: crypto.randomUUID(), message: "잔액 확인", provider: "gemini" };
  assert.equal((await post(base, "/api/chat", body)).status, 200);
  assert.equal((await post(base, "/api/chat", body)).status, 200);
  assert.equal((await post(base, "/api/chat", { ...body, provider: "openai" })).status, 409);
  assert.equal((await post(base, "/api/chat", { ...body, requestId: crypto.randomUUID(), provider: "unexpected" })).status, 400);
  assert.deepEqual(selected, ["gemini"]);
});
