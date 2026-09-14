import { listActivity, type Activity } from "./activity.js";
import { env } from "./config.js";
import { readBlob } from "./walrus.js";

export async function recallPayments(
  limit = 5,
  entries: Activity[] = listActivity(),
  read: (blobId: string) => Promise<string> = readBlob,
  allowanceId = env("ALLOWANCE_ID"),
) {
  const recent = entries.filter((a) => a.allowanceId === allowanceId && a.source === "agent")
    .slice(0, Math.min(5, Math.max(1, limit)));
  return Promise.all(recent.map(async (a) => {
    const summary = {
      timestamp: a.timestamp, recipient: a.recipient, amountSui: a.amountSui,
      item: a.memo, status: a.status, reason: a.reason, digest: a.digest,
      logBlobId: a.logBlobId,
    };
    try {
      if (!a.logBlobId) throw new Error("No stored decision");
      const log = JSON.parse(await read(a.logBlobId));
      if (log.kind !== "agent-payment-decision" || log.allowanceId !== allowanceId ||
          log.recipient !== a.recipient || log.amountSui !== a.amountSui || log.memo !== a.memo) {
        throw new Error("Decision does not match the payment record");
      }
      return {
        ...summary, memoryAvailable: true,
        userRequest: typeof log.userRequest === "string" ? log.userRequest.slice(0, 2000) : "",
        agentReason: typeof log.agentReason === "string" ? log.agentReason.slice(0, 1000) : "",
      };
    } catch {
      return { ...summary, memoryAvailable: false, memoryNote: "판단 기록이 없거나 만료·조회 실패했습니다. 내용을 추측하지 마세요." };
    }
  }));
}
