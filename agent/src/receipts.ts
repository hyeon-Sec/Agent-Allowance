export interface SpendInput {
  recipient: string;
  amountSui: number;
  memo: string;
  logBlobId: string;
}

export interface SpendResult {
  status: "approved" | "blocked" | "error" | "unknown";
  digest?: string;
  reason?: string;
}

export const BLOCK_REASONS: Record<number, string> = {
  1: "소유자가 에이전트 결제를 일시정지함",
  2: "허용 목록에 없는 수신자",
  3: "1회 결제 한도 초과",
  4: "현재 24시간 주기 한도 초과",
  5: "Allowance 잔액 부족",
};

/** A successful transaction alone is not evidence of payment. Require its matching event. */
export function classifySpendEvents(
  events: { eventType: string; json: unknown }[],
  expected: { packageId: string; allowanceId: string; recipient: string; amount: bigint; memo: string; logBlobId: string },
  digest: string,
): SpendResult {
  const matching = events.filter((event) => {
    if (!["SpendApproved", "SpendBlocked"].some((name) =>
      event.eventType === `${expected.packageId}::allowance::${name}`)) return false;
    const data = event.json as Record<string, unknown> | null;
    return data?.allowance_id === expected.allowanceId && data.recipient === expected.recipient &&
      String(data.amount) === String(expected.amount) && data.memo === expected.memo &&
      data.log_blob_id === expected.logBlobId;
  });
  if (matching.length !== 1) {
    return { status: "unknown", digest, reason: "결제 결과 이벤트를 확인하지 못했습니다. 트랜잭션을 확인하기 전에는 다시 결제하지 마세요." };
  }
  const event = matching[0]!;
  if (event.eventType.endsWith("::SpendApproved")) return { status: "approved", digest };
  const reason = Number((event.json as { reason: unknown }).reason);
  return { status: "blocked", digest, reason: BLOCK_REASONS[reason] ?? `차단 코드 ${reason}` };
}
