import { recordActivity } from "./activity.js";
import { env } from "./config.js";
import { findMerchant } from "./merchants.js";
import { runPayment, type PaymentRequest } from "./payment-runner.js";
import { agentSigner, spendOnChain } from "./sui.js";
import { storeJson } from "./walrus.js";

export function executePayment(p: PaymentRequest) {
  return runPayment(p, {
    allowanceId: env("ALLOWANCE_ID"), agentAddress: agentSigner().toSuiAddress(),
    findMerchant, storeLog: storeJson, spend: spendOnChain, record: recordActivity,
  });
}
