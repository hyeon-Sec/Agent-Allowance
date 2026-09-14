import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { getAIConfig, PROVIDERS, type AIProvider } from "../src/ai-config.js";
import { runChat } from "../src/agent.js";
import { defaultToolDependencies } from "../src/agent-tools.js";
import { findMerchant } from "../src/merchants.js";
import type { Activity } from "../src/activity.js";
import type { AllowanceStatus } from "../src/sui.js";
import type { PaymentRequest } from "../src/payment-runner.js";
import { createAnthropicSession } from "../src/providers/anthropic.js";
import { createGeminiSession } from "../src/providers/gemini.js";
import { createOpenAISession } from "../src/providers/openai.js";
import type { ModelSession, ModelTurn, SessionOptions, ToolCall } from "../src/providers/types.js";

const configured = () => getAIConfig({ ANTHROPIC_API_KEY: "test-only", GEMINI_API_KEY: "test-only", OPENAI_API_KEY: "test-only" });
const payArgs = { recipient: "campus-store", amount_sui: 0.01, item: "삼각김밥", reason: "예산 내 구매" };
const pay = (id: string, input: unknown = payArgs): ToolCall => ({ id, name: "pay", input });
const finalTurn: ModelTurn = { text: "결제 결과를 확인했습니다.", reasoning: "", toolCalls: [] };
const turn = (...toolCalls: ToolCall[]): ModelTurn => ({ text: "", reasoning: "예산 확인", toolCalls });
const receipt = (p: PaymentRequest, status: Activity["status"] = "approved"): Activity => ({
  ...p, recipient: findMerchant(p.recipient)?.address ?? p.recipient, id: "receipt", timestamp: 1,
  status, digest: "test-tx", logBlobId: "test-blob",
});
const policy: AllowanceStatus = {
  allowanceId: "allowance", agent: "agent", balanceSui: 0.3, perTxLimitSui: 0.1, dailyLimitSui: 0.2,
  spentInWindowSui: 0, remainingInWindowSui: 0.2, windowMode: "resetting-24h", windowResetsAt: null,
  windowExpired: true, totalSpentSui: 0, paused: false, allowedRecipients: [findMerchant("campus-store")!.address],
};
function dependencies(createModelSession: (options: SessionOptions) => ModelSession,
  executePayment = async (p: PaymentRequest) => receipt(p)) {
  return { getAIConfig: configured, createModelSession, tools: { ...defaultToolDependencies,
    getAllowanceStatus: async () => policy, recallPayments: async () => [], executePayment } };
}
function script(turns: (ModelTurn | Error)[]): ModelSession {
  let i = 0;
  return { next: async () => {
    const next = turns[i++];
    if (!next) throw new Error("Unexpected extra model request");
    if (next instanceof Error) throw next;
    return next;
  } };
}

test("public provider configuration has all options but no credential values", () => {
  const config = getAIConfig({ AI_PROVIDER: "openai", OPENAI_API_KEY: "a-secret-key", GEMINI_API_KEY: " " });
  assert.equal(config.defaultProvider, "openai");
  assert.deepEqual(config.providers.map((p) => [p.id, p.available]), [["anthropic", false], ["gemini", false], ["openai", true]]);
  assert.doesNotMatch(JSON.stringify(config), /a-secret-key/);
  assert.throws(() => getAIConfig({ AI_PROVIDER: "typo" }));
});
test("an unconfigured selected provider never falls back or constructs an API client", async () => {
  const deps = dependencies(() => { throw new Error("Client must not be created"); });
  deps.getAIConfig = () => getAIConfig({ ANTHROPIC_API_KEY: "configured-but-not-selected" });
  const result = await runChat([], "잔액 확인", "gemini", deps);
  assert.equal(result.provider, "gemini");
  assert.match(result.reply, /GEMINI_API_KEY/);
  assert.equal(result.toolCalls.length, 0);
  assert.equal(result.payments.length, 0);
});

for (const provider of PROVIDERS) {
  test(`${provider}: duplicate payments are executed once and provider/model are bound to the audit record`, async () => {
    const requests: PaymentRequest[] = [];
    let chosen: AIProvider | undefined;
    const result = await runChat([], "삼각김밥 하나", provider, dependencies((options) => {
      chosen = options.provider.id;
      return script([turn(pay("one"), pay("two")), finalTurn]);
    }, async (p) => { requests.push(p); return receipt(p); }));
    assert.equal(chosen, provider);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.decision.provider, provider);
    assert.equal(requests[0]!.decision.model, result.model);
    assert.equal(result.payments.length, 1);
    assert.equal(result.reply, finalTurn.text);
  });
  test(`${provider}: unknown payment blocks subsequent different purchases in the same request`, async () => {
    let payments = 0;
    const result = await runChat([], "두 개 사줘", provider, dependencies(() => script([
      turn(pay("one"), pay("two", { ...payArgs, item: "다른 물품" })), finalTurn,
    ]), async (p) => { payments++; return receipt(p, "unknown"); }));
    assert.equal(payments, 1);
    assert.equal(result.payments[0]!.status, "unknown");
  });
  test(`${provider}: provider error after pay preserves receipts and does not retry or switch`, async () => {
    let sessions = 0;
    let payments = 0;
    const result = await runChat([], "삼각김밥", provider, dependencies(() => {
      sessions++; return script([turn(pay("one")), new Error("secret-response")]);
    }, async (p) => { payments++; return receipt(p); }));
    assert.equal(sessions, 1);
    assert.equal(payments, 1);
    assert.equal(result.payments[0]!.digest, "test-tx");
    assert.match(result.reply, /결제 결과와 결제 기록을 확인/);
    assert.doesNotMatch(result.reply, /결제는 실행하지 않았습니다|secret-response/);
  });
}

test("unknown tools and invalid pay arguments cannot reach the payment service", async () => {
  let payments = 0;
  const result = await runChat([], "test", "gemini", dependencies(() => script([
    turn({ id: "evil", name: "owner_withdraw", input: {} }, pay("bad", { ...payArgs, amount_sui: -1 }), pay("extra", { ...payArgs, admin: true })), finalTurn,
  ]), async (p) => { payments++; return receipt(p); }));
  assert.equal(payments, 0);
  assert.equal(result.payments.length, 0);
});
test("an unexpected exception during payment never claims that no payment occurred", async () => {
  const result = await runChat([], "삼각김밥", "openai", dependencies(() => script([turn(pay("one"))]), async () => {
    throw new Error("lost result after submission");
  }));
  assert.match(result.reply, /결제 시도가 있었습니다/);
  assert.doesNotMatch(result.reply, /결제는 실행하지 않았습니다/);
});
test("repeated tool IDs replay results, but changing their payload stops execution", async () => {
  let payments = 0;
  const result = await runChat([], "삼각김밥", "openai", dependencies(() => script([
    turn(pay("same")), turn(pay("same")), turn(pay("same", { ...payArgs, item: "다른 물품" })),
  ]), async (p) => { payments++; return receipt(p); }));
  assert.equal(payments, 1);
  assert.match(result.reply, /응답 형식/);
});
test("tool-round limits stop before executing more payments", async () => {
  let calls = 0;
  const result = await runChat([], "test", "gemini", dependencies(() => ({ next: async () => turn({ id: String(++calls), name: "get_allowance", input: {} }) })));
  assert.equal(calls, 10);
  assert.equal(result.toolCalls.length, 9);
  assert.match(result.reply, /처리 단계 한도/);
});

// Run each real SDK against a loopback HTTP fixture. No model service, Walrus, or chain calls.
interface StubReply { status?: number; body: unknown; }
async function modelServer(t: TestContext, replies: StubReply[]) {
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    bodies.push(JSON.parse(Buffer.concat(chunks).toString())); urls.push(req.url!);
    const next = replies[bodies.length - 1];
    res.writeHead(next?.status ?? 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(next?.body ?? { error: "Unexpected extra model request" }));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())));
  return { baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, bodies, urls };
}
function wireReply(provider: AIProvider, calls: ToolCall[] = [], incomplete = false) {
  if (provider === "anthropic") return {
    id: "msg_fixture", type: "message", role: "assistant", model: "fixture", stop_reason: incomplete ? "max_tokens" : calls.length ? "tool_use" : "end_turn",
    stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
    content: calls.length ? [ { type: "thinking", thinking: "fixture summary", signature: "signed-thought" },
      ...calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })) ] : [{ type: "text", text: "연결 확인 완료" }],
  };
  if (provider === "openai") return {
    id: "resp_fixture", object: "response", created_at: 1, model: "fixture", status: incomplete ? "incomplete" : "completed",
    output: calls.length ? [ { id: "rs_fixture", type: "reasoning", summary: [{ type: "summary_text", text: "fixture summary" }], encrypted_content: "signed-thought" },
      ...calls.map((c) => ({ type: "function_call", id: `fc_${c.id}`, call_id: c.id, name: c.name, arguments: JSON.stringify(c.input), status: "completed" })) ]
      : [{ id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "연결 확인 완료", annotations: [] }] }],
  };
  return {
    id: "interaction_fixture", object: "interaction", model: "fixture", status: incomplete ? "incomplete" : calls.length ? "requires_action" : "completed",
    steps: calls.length ? [ { type: "thought", summary: [{ type: "text", text: "fixture summary" }], signature: "signed-thought" },
      ...calls.map((c) => ({ type: "function_call", id: c.id, name: c.name, arguments: c.input })) ] : [{ type: "model_output", content: [{ type: "text", text: "연결 확인 완료" }] }],
  };
}
function wireSession(provider: AIProvider, options: SessionOptions, baseURL: string): ModelSession {
  if (provider === "anthropic") return createAnthropicSession(options, new Anthropic({ apiKey: "test-only", authToken: null, baseURL, maxRetries: 0 }));
  if (provider === "openai") return createOpenAISession(options, new OpenAI({ apiKey: "test-only", baseURL, maxRetries: 0 }));
  return createGeminiSession(options, new GoogleGenAI({ apiKey: "test-only", vertexai: false, httpOptions: { baseUrl: baseURL } }));
}
for (const provider of PROVIDERS) {
  test(`${provider} SDK: history, tool results, and signed reasoning survive multiple rounds`, async (t) => {
    const server = await modelServer(t, [
      { body: wireReply(provider, [{ id: "policy", name: "get_allowance", input: {} }]) },
      { body: wireReply(provider, [pay("purchase")]) }, { body: wireReply(provider) },
    ]);
    const payments: PaymentRequest[] = [];
    const result = await runChat([{ role: "user", content: "이전 요청" }, { role: "assistant", content: "이전 답변" }], "삼각김밥", provider,
      dependencies((options) => wireSession(provider, options, server.baseURL), async (p) => { payments.push(p); return receipt(p); }));
    assert.equal(result.reply, "연결 확인 완료");
    assert.equal(payments.length, 1);
    assert.equal(payments[0]!.decision.agentReasoningSummary, "fixture summary");
    assert.equal(server.bodies.length, 3);
    const first = JSON.stringify(server.bodies[0]);
    assert.match(first, /이전 요청/); assert.match(first, /이전 답변/);
    assert.match(first, /한도 초과가 명확하면/);
    assert.match(JSON.stringify(server.bodies[1]), /signed-thought/);
    assert.match(JSON.stringify(server.bodies[1]), /balanceSui/);
    assert.match(JSON.stringify(server.bodies[2]), /test-tx/);
    if (provider !== "anthropic") assert.equal(server.bodies[0]!.store, false);
    if (provider === "openai") {
      assert.equal(server.bodies[0]!.parallel_tool_calls, false);
      assert.match(JSON.stringify(server.bodies[1]), /function_call_output/);
    } else if (provider === "gemini") {
      assert.match(server.urls[0]!, /interactions/);
      assert.match(JSON.stringify(server.bodies[1]), /function_result/);
    }
  });
  test(`${provider} SDK: an incomplete response cannot execute its pay call`, async (t) => {
    const server = await modelServer(t, [{ body: wireReply(provider, [pay("incomplete")], true) }]);
    let payments = 0;
    const result = await runChat([], "삼각김밥", provider, dependencies((options) => wireSession(provider, options, server.baseURL), async (p) => { payments++; return receipt(p); }));
    assert.equal(payments, 0);
    assert.equal(server.bodies.length, 1);
    assert.match(result.reply, /응답이 완료되지 않아/);
  });
  test(`${provider} SDK: quota errors after pay do not retry HTTP or lose receipts`, async (t) => {
    const error = provider === "anthropic"
      ? { type: "error", error: { type: "rate_limit_error", message: "private-provider-message" } }
      : provider === "openai" ? { error: { type: "insufficient_quota", code: "insufficient_quota", message: "private-provider-message" } }
      : { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "private-provider-message" } };
    const server = await modelServer(t, [{ body: wireReply(provider, [pay("purchase")]) }, { status: 429, body: error }]);
    const result = await runChat([], "삼각김밥", provider, dependencies((options) => wireSession(provider, options, server.baseURL)));
    assert.equal(server.bodies.length, 2);
    assert.equal(result.payments.length, 1);
    assert.match(result.reply, /반복하지 마세요/);
    assert.doesNotMatch(result.reply, /결제는 실행하지 않았습니다|private-provider-message/);
    assert.match(result.reply, provider === "openai" ? /OpenAI API 크레딧/ : provider === "gemini" ? /Gemini API 할당량/ : /Anthropic API 요청 한도/);
  });
}
