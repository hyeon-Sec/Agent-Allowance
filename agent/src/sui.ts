import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { config, env } from "./config.js";
import { toMist, toSui } from "./amounts.js";
import { classifySpendEvents, type SpendInput, type SpendResult } from "./receipts.js";
import { windowStatus } from "./policy.js";
export { toMist, toSui } from "./amounts.js";
export type { SpendResult } from "./receipts.js";

export const client = new SuiGrpcClient({ network: "testnet", baseUrl: config.fullnodeUrl });

let agentKeypair: Ed25519Keypair | undefined;
export function agentSigner(): Ed25519Keypair {
  agentKeypair ??= Ed25519Keypair.fromSecretKey(env("AGENT_SECRET_KEY"));
  return agentKeypair;
}

const target = (fn: string) => `${env("PACKAGE_ID")}::allowance::${fn}` as const;

/** Calls `allowance::spend` with the agent key. The Move code decides; we only report. */
export async function spendOnChain(p: SpendInput): Promise<SpendResult> {
  const tx = new Transaction();
  tx.moveCall({
    target: target("spend"),
    arguments: [
      tx.object(env("ALLOWANCE_ID")),
      tx.pure.address(p.recipient),
      tx.pure.u64(toMist(p.amountSui)),
      tx.pure.string(p.memo),
      tx.pure.string(p.logBlobId),
      tx.object.clock(),
    ],
  });

  const signer = agentSigner();
  tx.setSender(signer.toSuiAddress());
  let bytes: Uint8Array;
  try {
    // Gas selection and simulation happen here, before anything is sent.
    bytes = await tx.build({ client });
  } catch (err) {
    const detail = err instanceof Error ? err.message.slice(0, 200) : String(err);
    return { status: "error", reason: `트랜잭션을 만들지 못해 전송하지 않았습니다 (에이전트 가스 부족 등): ${detail}` };
  }

  let result;
  try {
    result = await client.signAndExecuteTransaction({
      transaction: bytes,
      signer,
      include: { events: true },
    });
  } catch {
    // Submission may have succeeded before a transport timeout. Never encourage a retry.
    return { status: "unknown", reason: "체인 응답을 받지 못해 결제 여부를 확인할 수 없습니다. 탐색기에서 확인하기 전에는 다시 결제하지 마세요." };
  }

  if (result.$kind === "FailedTransaction") {
    const failed = result.FailedTransaction;
    return { status: "error", digest: failed.digest, reason: JSON.stringify(failed.status.error) };
  }

  const txn = result.Transaction;
  return classifySpendEvents(txn.events ?? [], {
    packageId: env("PACKAGE_ID"), allowanceId: env("ALLOWANCE_ID"),
    recipient: p.recipient, amount: toMist(p.amountSui), memo: p.memo, logBlobId: p.logBlobId,
  }, txn.digest);
}

export interface AllowanceStatus {
  allowanceId: string;
  agent: string;
  balanceSui: number;
  perTxLimitSui: number;
  dailyLimitSui: number;
  spentInWindowSui: number;
  remainingInWindowSui: number;
  windowResetsAt: number | null;
  windowExpired: boolean;
  windowMode: "resetting-24h";
  totalSpentSui: number;
  paused: boolean;
  allowedRecipients: string[];
}

// gRPC JSON renders u64 as strings and wrapper structs (Balance, VecSet) inconsistently
// across transports, so unwrap defensively.
const num = (v: unknown): number => {
  if (typeof v === "number" || typeof v === "string") {
    const value = Number(v);
    if (Number.isSafeInteger(value) && value >= 0) return value;
    throw new Error("온체인 정책의 숫자가 지원 범위를 벗어났습니다.");
  }
  if (v && typeof v === "object" && "value" in v) return num((v as { value: unknown }).value);
  throw new Error("온체인 정책의 숫자 필드를 해석하지 못했습니다.");
};
const addresses = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (v && typeof v === "object" && "contents" in v) return addresses((v as { contents: unknown }).contents);
  throw new Error("온체인 허용 상점 목록을 해석하지 못했습니다.");
};

export async function getAllowanceStatus(): Promise<AllowanceStatus> {
  const allowanceId = env("ALLOWANCE_ID");
  const [{ object }, { object: clock }] = await Promise.all([
    client.getObject({ objectId: allowanceId, include: { json: true } }),
    client.getObject({ objectId: "0x6", include: { json: true } }),
  ]);
  const f = (object.json ?? {}) as Record<string, unknown>;
  const dailyLimit = num(f.daily_limit);
  const windowStart = num(f.window_start_ms);
  const chainNow = num((clock.json as Record<string, unknown>).timestamp_ms);
  if (typeof f.paused !== "boolean" || typeof f.agent !== "string") {
    throw new Error("온체인 정책 형식이 올바르지 않습니다.");
  }
  return {
    allowanceId,
    agent: String(f.agent ?? ""),
    balanceSui: toSui(num(f.balance)),
    perTxLimitSui: toSui(num(f.per_tx_limit)),
    dailyLimitSui: toSui(dailyLimit),
    ...windowStatus(windowStart, num(f.spent_in_window), dailyLimit, chainNow),
    totalSpentSui: toSui(num(f.total_spent)),
    paused: Boolean(f.paused),
    allowedRecipients: addresses(f.allowed_recipients),
  };
}
