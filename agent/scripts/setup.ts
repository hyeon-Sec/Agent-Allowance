/**
 * Creates the demo Allowance on testnet with the owner key, sends the agent a
 * little gas, and writes ALLOWANCE_ID / OWNER_CAP_ID into .env.
 *
 *   npm run setup                # defaults below
 *   FUND_SUI=0.5 npm run setup
 */
import fs from "node:fs";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { env } from "../src/config.js";
import { ALLOWLISTED_MERCHANT_IDS, findMerchant } from "../src/merchants.js";
import { agentSigner, client, toMist } from "../src/sui.js";

// Run this only in the owner's environment. Never put this key in the agent's .env.
const ownerSigner = Ed25519Keypair.fromSecretKey(env("SETUP_OWNER_SECRET_KEY"));
delete process.env.SETUP_OWNER_SECRET_KEY;

const FUND_SUI = Number(process.env.FUND_SUI ?? 0.3);
const PER_TX_SUI = Number(process.env.PER_TX_SUI ?? 0.1);
const DAILY_SUI = Number(process.env.DAILY_SUI ?? 0.2);
const AGENT_GAS_SUI = Number(process.env.AGENT_GAS_SUI ?? 0.05);

const agent = agentSigner().toSuiAddress();
const recipients = ALLOWLISTED_MERCHANT_IDS.map((id) => findMerchant(id)!.address);

const tx = new Transaction();
const [funds, agentGas] = tx.splitCoins(tx.gas, [toMist(FUND_SUI), toMist(AGENT_GAS_SUI)]);
tx.moveCall({
  target: `${env("PACKAGE_ID")}::allowance::create_and_keep`,
  arguments: [
    tx.pure.address(agent),
    tx.pure.u64(toMist(PER_TX_SUI)),
    tx.pure.u64(toMist(DAILY_SUI)),
    tx.pure.vector("address", recipients),
    funds,
    tx.object.clock(),
  ],
});
tx.transferObjects([agentGas], agent);

const result = await client.signAndExecuteTransaction({
  transaction: tx,
  signer: ownerSigner,
  include: { effects: true, objectTypes: true },
});
if (result.$kind === "FailedTransaction") {
  throw new Error(`Setup failed: ${JSON.stringify(result.FailedTransaction.status.error)}`);
}

const { digest, effects, objectTypes } = result.Transaction;
const createdOfType = (suffix: string) =>
  effects.changedObjects.find(
    (o) => o.idOperation === "Created" && objectTypes[o.objectId]?.endsWith(suffix),
  )?.objectId;
const allowanceId = createdOfType("::allowance::Allowance");
const ownerCapId = createdOfType("::allowance::OwnerCap");
if (!allowanceId || !ownerCapId) throw new Error(`Created objects not found in ${digest}`);

const envPath = ".env";
let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
for (const [key, value] of Object.entries({ ALLOWANCE_ID: allowanceId, OWNER_CAP_ID: ownerCapId })) {
  const line = `${key}=${value}`;
  text = new RegExp(`^${key}=.*$`, "m").test(text)
    ? text.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${text.trimEnd()}\n${line}\n`;
}
fs.writeFileSync(envPath, text);

console.log(`tx:           https://suiscan.xyz/testnet/tx/${digest}`);
console.log(`ALLOWANCE_ID=${allowanceId}`);
console.log(`OWNER_CAP_ID=${ownerCapId}`);
console.log(`agent ${agent} funded with ${AGENT_GAS_SUI} SUI gas; allowance holds ${FUND_SUI} SUI`);
