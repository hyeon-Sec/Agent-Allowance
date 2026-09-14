import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { toMist } from "../src/amounts.js";
import { PaymentQueue } from "../src/payment-queue.js";
import { windowStatus } from "../src/policy.js";
import { classifySpendEvents } from "../src/receipts.js";
import { runPayment, type PaymentServices, type PaymentRequest } from "../src/payment-runner.js";
import { recallPayments } from "../src/memory.js";
import { buildOwnerTransaction } from "../browser/owner-transactions.js";
import type { Activity } from "../src/activity.js";
import { defaultToolDependencies, makeTools } from "../src/agent-tools.js";
import type { RunContext } from "../src/chat-types.js";

const address = normalizeSuiAddress("0xc");
const request: PaymentRequest = { source: "agent", recipient: address, amountSui: 0.05, memo: "lunch", decision: { userRequest: "lunch please" } };
function services(overrides: Partial<PaymentServices> = {}): PaymentServices {
  return {
    allowanceId: "allowance", agentAddress: "agent", findMerchant: () => undefined,
    storeLog: async () => ({ blobId: "A".repeat(43), storageEpochs: 5, endEpoch: 100 }),
    spend: async () => ({ status: "approved", digest: "tx" }),
    record: (a) => ({ ...a, id: "record", timestamp: 1 }), ...overrides,
  };
}

test("amounts preserve MIST and reject rounding/unsafe values", () => {
  assert.equal(toMist(0.07), 70_000_000n);
  assert.equal(toMist(0.000000001), 1n);
  assert.equal(toMist("1.123456789"), 1_123_456_789n);
  for (const amount of [0, -1, NaN, Infinity, 0.0000000001, 0.1234567891, 1e10, "1e2", "0.0000000001"]) {
    assert.throws(() => toMist(amount));
  }
});

test("failed audit storage never submits a payment", async () => {
  let submitted = 0;
  const result = await runPayment(request, services({
    storeLog: async () => { throw new Error("publisher unavailable"); },
    spend: async () => { submitted++; return { status: "approved" }; },
  }));
  assert.equal(result.status, "error");
  assert.equal(result.failureStage, "audit");
  assert.equal(submitted, 0);
});

test("invalid amounts and addresses never reach storage or chain", async () => {
  let calls = 0;
  const deps = services({ storeLog: async () => { calls++; throw new Error(); }, spend: async () => { calls++; throw new Error(); } });
  for (const p of [{ ...request, amountSui: 0.0000000001 }, { ...request, recipient: "invalid" }]) {
    assert.equal((await runPayment(p, deps)).failureStage, "validation");
  }
  assert.equal(calls, 0);
});

test("payment binds the verified record to the actual recipient and amount", async () => {
  const order: string[] = [];
  const result = await runPayment({ ...request, decision: { recipient: "forged", amountSui: 99 } }, services({
    storeLog: async (log) => {
      order.push("store");
      assert.equal((log as Record<string, unknown>).recipient, address);
      assert.equal((log as Record<string, unknown>).amountMist, "50000000");
      return { blobId: "A".repeat(43), storageEpochs: 5 };
    },
    spend: async (p) => { order.push("spend"); assert.equal(p.logBlobId, "A".repeat(43)); return { status: "blocked", digest: "tx", reason: "limit" }; },
  }));
  assert.deepEqual(order, ["store", "spend"]);
  assert.equal(result.status, "blocked");
  assert.equal(result.digest, "tx");
});

test("lost chain responses remain unknown rather than failed or approved", async () => {
  const result = await runPayment(request, services({ spend: async () => { throw new Error("connection lost after submission"); } }));
  assert.equal(result.status, "unknown");
  assert.ok(result.logBlobId);
});

const expected = { packageId: "package", allowanceId: "allowance", recipient: address, amount: 50_000_000n, memo: "lunch", logBlobId: "blob" };
const event = { eventType: "package::allowance::SpendApproved", json: { allowance_id: "allowance", recipient: address, amount: "50000000", memo: "lunch", log_blob_id: "blob" } };
test("only the matching approval event proves payment", () => {
  assert.equal(classifySpendEvents([event], expected, "tx").status, "approved");
  for (const events of [[], [{ ...event, eventType: "other::allowance::SpendApproved" }], [{ ...event, json: { ...event.json, amount: "1" } }], [event, event]]) {
    assert.equal(classifySpendEvents(events, expected, "tx").status, "unknown");
  }
});
test("matching denial events retain their reason", () => {
  const result = classifySpendEvents([{ eventType: "package::allowance::SpendBlocked", json: { ...event.json, reason: 4 } }], expected, "tx");
  assert.equal(result.status, "blocked");
  assert.match(result.reason!, /24시간 주기/);
});

test("window expiry uses chain time and does not invent a moving reset time", () => {
  const before = windowStatus(1000, 200_000_000, 200_000_000, 86_400_999);
  assert.equal(before.remainingInWindowSui, 0);
  assert.equal(before.windowResetsAt, 86_401_000);
  const expired = windowStatus(1000, 200_000_000, 200_000_000, 86_401_000);
  assert.equal(expired.remainingInWindowSui, 0.2);
  assert.equal(expired.windowResetsAt, null);
  assert.equal(expired.windowMode, "resetting-24h");
});

test("memory reads matching Walrus records and isolates other allowances", async () => {
  const activity: Activity = { ...request, recipient: address, id: "1", timestamp: 1, allowanceId: "allowance", status: "approved", logBlobId: "blob" };
  let calls = 0;
  const results = await recallPayments(5, [{ ...activity, allowanceId: "other" }, activity], async () => {
    calls++;
    return JSON.stringify({ kind: "agent-payment-decision", allowanceId: "allowance", recipient: address, amountSui: 0.05, memo: "lunch", userRequest: "lunch please", agentReason: "fits budget" });
  }, "allowance");
  assert.equal(calls, 1);
  assert.equal(results[0]!.memoryAvailable, true);
  assert.equal((results[0] as { userRequest: string }).userRequest, "lunch please");
  const missing = await recallPayments(1, [activity], async () => JSON.stringify({ recipient: "forged" }), "allowance");
  assert.equal(missing[0]!.memoryAvailable, false);
});

test("owner changes produce only the requested capability-guarded Move call", () => {
  const config = { packageId: normalizeSuiAddress("0xa"), allowanceId: normalizeSuiAddress("0xb"), ownerCapId: normalizeSuiAddress("0xc") };
  const tx = buildOwnerTransaction(config, { kind: "limits", perTxSui: "0.1", dailySui: "0.2" });
  const commands = tx.getData().commands;
  assert.equal(commands.length, 1);
  assert.equal(commands[0]!.MoveCall?.function, "set_limits");
  assert.equal(commands[0]!.MoveCall?.arguments.length, 4);
  assert.throws(() => buildOwnerTransaction(config, { kind: "limits", perTxSui: "0.0000000001", dailySui: "0.2" }));
});

test("parallel tool calls are serialized through receipt completion", async () => {
  const queue = new PaymentQueue();
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = queue.run(async () => { order.push("first-start"); await gate; order.push("first-end"); });
  const second = queue.run(async () => { order.push("second"); });
  await Promise.resolve();
  assert.deepEqual(order, ["first-start"]);
  release(); await Promise.all([first, second]);
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
});
test("a repeated identical pay call is reported as skipped, not as a second purchase", async () => {
  let executed = 0;
  const ctx: RunContext = { provider: "anthropic", model: "test", userRequest: "아메리카노 두 잔", lastReasoning: "",
    payments: [], paymentAttempted: false, paymentUncertain: false };
  const pay = makeTools(ctx, {
    ...defaultToolDependencies,
    executePayment: async (p) => {
      executed++;
      return { id: "r", timestamp: 1, source: "agent", status: "approved", recipient: p.recipient,
        amountSui: p.amountSui, memo: p.memo, digest: "tx" } satisfies Activity;
    },
  }).find((t) => t.name === "pay")!;
  const input = { recipient: address, amount_sui: 0.02, item: "아메리카노", reason: "요청" };

  assert.match(await pay.run(input), /^승인됨/);
  const second = await pay.run(input);
  assert.equal(executed, 1);
  assert.match(second, /^중복 요청이라 실행하지 않음/);
});

test("a local disk failure after payment does not erase the approval receipt", async () => {
  const result = await runPayment(request, services({ record: () => { throw new Error("disk full"); } }));
  assert.equal(result.status, "approved");
  assert.equal(result.digest, "tx");
  assert.ok(result.recordingError);
});
