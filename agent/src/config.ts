import dotenv from "dotenv";

const runtimeEnv: Record<string, string> = {};
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH ?? ".env", processEnv: runtimeEnv, quiet: true });
// Never import a setup/owner private key into the agent runtime.
for (const [name, value] of Object.entries(runtimeEnv)) {
  if (name !== "OWNER_SECRET_KEY" && name !== "SETUP_OWNER_SECRET_KEY") process.env[name] ??= value;
}

export function assertNoOwnerKey() {
  if (runtimeEnv.OWNER_SECRET_KEY || runtimeEnv.SETUP_OWNER_SECRET_KEY ||
      process.env.OWNER_SECRET_KEY || process.env.SETUP_OWNER_SECRET_KEY) {
    throw new Error("소유자 키를 에이전트 서버에 보관할 수 없습니다. .env의 OWNER_SECRET_KEY를 제거하고 소유자 지갑을 사용하세요. 초기 설정 키는 소유자 환경에서만 SETUP_OWNER_SECRET_KEY로 전달하세요.");
  }
}

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name} (see .env.example)`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: "127.0.0.1",
  fullnodeUrl: process.env.SUI_FULLNODE_URL ?? "https://fullnode.testnet.sui.io:443",
  walrusPublisher: process.env.WALRUS_PUBLISHER ?? "https://publisher.walrus-testnet.walrus.space",
  walrusAggregator: process.env.WALRUS_AGGREGATOR ?? "https://aggregator.walrus-testnet.walrus.space",
  walrusEpochs: Number(process.env.WALRUS_EPOCHS ?? 5),
  explorerTx: (digest: string) => `https://suiscan.xyz/testnet/tx/${digest}`,
  explorerObject: (id: string) => `https://suiscan.xyz/testnet/object/${id}`,
};
