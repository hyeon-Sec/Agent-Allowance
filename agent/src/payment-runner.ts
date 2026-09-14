import { isValidSuiAddress, normalizeSuiAddress } from "@mysten/sui/utils";
import type { Activity } from "./activity.js";
import { toMist } from "./amounts.js";
import type { SpendInput, SpendResult } from "./receipts.js";
import type { StoredLog } from "./walrus.js";

export interface PaymentRequest {
  source: Activity["source"];
  recipient: string;
  amountSui: number;
  memo: string;
  decision: Record<string, unknown>;
}

export interface PaymentServices {
  allowanceId: string;
  agentAddress: string;
  findMerchant: (value: string) => { address: string; name: string } | undefined;
  storeLog: (data: unknown) => Promise<StoredLog>;
  spend: (input: SpendInput) => Promise<SpendResult>;
  record: (entry: Omit<Activity, "id" | "timestamp">) => Activity;
}

/** Store and read back a decision before submitting a payment. */
export async function runPayment(p: PaymentRequest, services: PaymentServices): Promise<Activity> {
  const merchant = services.findMerchant(p.recipient);
  const recipient = normalizeSuiAddress(merchant?.address ?? p.recipient.trim());
  const entry = {
    allowanceId: services.allowanceId, source: p.source, recipient,
    recipientName: merchant?.name, amountSui: p.amountSui, memo: p.memo,
  };
  try {
    if (!isValidSuiAddress(recipient)) throw new Error("유효하지 않은 수신자 주소입니다.");
    toMist(p.amountSui);
    if (!p.memo.trim() || p.memo.length > 500) throw new Error("구매 품목은 1~500자여야 합니다.");
  } catch (err) {
    return services.record({ ...entry, status: "error", failureStage: "validation", reason: (err as Error).message });
  }

  let log: StoredLog;
  try {
    log = await services.storeLog({
      ...p.decision,
      kind: "agent-payment-decision", version: 2, timestamp: new Date().toISOString(),
      allowanceId: services.allowanceId, agent: services.agentAddress,
      source: p.source, recipient, recipientName: merchant?.name ?? null,
      amountSui: p.amountSui, amountMist: String(toMist(p.amountSui)), memo: p.memo,
    });
  } catch {
    return services.record({
      ...entry, status: "error", failureStage: "audit",
      reason: "판단 기록을 저장·확인하지 못해 송금을 시작하지 않았습니다. Walrus 연결을 확인하세요.",
    });
  }

  let result: SpendResult;
  try {
    result = await services.spend({ recipient, amountSui: p.amountSui, memo: p.memo, logBlobId: log.blobId });
  } catch {
    result = { status: "unknown", reason: "결제 결과를 확인하지 못했습니다. 체인 기록을 확인하기 전에는 다시 결제하지 마세요." };
  }
  const final: Omit<Activity, "id" | "timestamp"> = {
    ...entry, ...result, logBlobId: log.blobId, logEndEpoch: log.endEpoch,
    logStorageEpochs: log.storageEpochs,
    failureStage: ["error", "unknown"].includes(result.status) ? "chain" : undefined,
  };
  try { return services.record(final); }
  catch {
    // A local disk error after submission must not erase the receipt seen by the caller.
    return { ...final, id: crypto.randomUUID(), timestamp: Date.now(),
      recordingError: "로컬 기록 저장에 실패했습니다. 이 결제 결과와 트랜잭션 링크를 보관하세요." };
  }
}
