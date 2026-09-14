/** Remove the legacy runtime key only if an identical key already exists in the owner's Sui keystore. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

const file = path.resolve(".env");
const source = fs.readFileSync(file, "utf8");
const parsed = dotenv.parse(source);
const legacy = parsed.OWNER_SECRET_KEY;
if (!legacy) {
  console.log("No legacy owner key to migrate.");
} else {
  const key = Ed25519Keypair.fromSecretKey(legacy);
  const decoded = decodeSuiPrivateKey(key.getSecretKey());
  const encoded = Buffer.concat([Buffer.from([0]), Buffer.from(decoded.secretKey)]).toString("base64");
  const keystorePath = path.join(os.homedir(), ".sui/sui_config/sui.keystore");
  const keystore: unknown = JSON.parse(fs.readFileSync(keystorePath, "utf8"));
  if (!Array.isArray(keystore) || !keystore.includes(encoded)) {
    throw new Error("Owner key backup was not found in the local Sui keystore. Preserve the key in your owner wallet before removing OWNER_SECRET_KEY from .env.");
  }
  const cleaned = source.replace(/^(?:export\s+)?OWNER_SECRET_KEY\s*=.*(?:\r?\n|$)/gm, "");
  if (dotenv.parse(cleaned).OWNER_SECRET_KEY) throw new Error("Could not safely remove the legacy key.");
  fs.writeFileSync(file, cleaned, { mode: 0o600 });
  console.log(`Removed the duplicate owner key from agent/.env. The existing Sui keystore retains owner ${key.toSuiAddress()}.`);
}
