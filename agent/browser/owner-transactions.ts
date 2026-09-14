import { Transaction } from "@mysten/sui/transactions";
import { toMist } from "../src/amounts.js";

export interface OwnerConfig { packageId: string; allowanceId: string; ownerCapId: string }
export type OwnerAction = { kind: "pause"; paused: boolean } |
  { kind: "limits"; perTxSui: string; dailySui: string };

export function buildOwnerTransaction(config: OwnerConfig, action: OwnerAction): Transaction {
  const tx = new Transaction();
  const args = action.kind === "pause"
    ? [tx.pure.bool(action.paused)]
    : [tx.pure.u64(toMist(action.perTxSui)), tx.pure.u64(toMist(action.dailySui))];
  tx.moveCall({
    target: `${config.packageId}::allowance::${action.kind === "pause" ? "set_paused" : "set_limits"}`,
    arguments: [tx.object(config.allowanceId), tx.object(config.ownerCapId), ...args],
  });
  return tx;
}
