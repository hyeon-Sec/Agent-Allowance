/** Deterministic UI verification only. Does not call model providers, Walrus, or Sui. */
import { getAIConfig } from "../src/ai-config.js";
import { createApp } from "../src/app.js";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import type { Activity } from "../src/activity.js";
const id = normalizeSuiAddress("0xb");
process.env.PACKAGE_ID = normalizeSuiAddress("0xa");
process.env.ALLOWANCE_ID = id;
process.env.OWNER_CAP_ID = normalizeSuiAddress("0xc");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
const activities: Activity[] = [];
createApp({
  agentAddress: () => normalizeSuiAddress("0xd"), listActivity: () => activities,
  getAllowanceStatus: async () => ({
    allowanceId: id, agent: normalizeSuiAddress("0xd"), balanceSui: 0.3,
    perTxLimitSui: 0.1, dailyLimitSui: 0.2, spentInWindowSui: 0.05, remainingInWindowSui: 0.15,
    windowResetsAt: 1_789_344_000_000, windowExpired: false, windowMode: "resetting-24h",
    totalSpentSui: 0.05, paused: false, allowedRecipients: [],
  }),
  runChat: async (history, message, provider) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { reply: `[테스트 응답] ${provider}: ${message} (이전 대화 ${history.length}개)`,
      provider, toolCalls: [{ name: "get_allowance", input: {} }], payments: [] };
  },
  executePayment: async (p) => {
    const activity: Activity = { ...p, id: crypto.randomUUID(), timestamp: Date.now(), allowanceId: id,
      status: "error", failureStage: "audit", reason: "판단 기록을 저장·확인하지 못해 송금을 시작하지 않았습니다. Walrus 연결을 확인하세요." };
    activities.unshift(activity);
    return activity;
  },
}, () => getAIConfig(process.env.VERIFY_CHAT === "1"
  ? { ANTHROPIC_API_KEY: "fixture", GEMINI_API_KEY: "fixture", OPENAI_API_KEY: "fixture" }
  : {})).listen(8788, "127.0.0.1", () => console.log("Fixture UI at http://127.0.0.1:8788 — no external calls"));
