import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/700.css";
import { createDAppKit } from "@mysten/dapp-kit-core";
import "@mysten/dapp-kit-core/web";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { buildOwnerTransaction, type OwnerAction, type OwnerConfig } from "./owner-transactions.js";

const client = new SuiGrpcClient({ network: "testnet", baseUrl: "https://fullnode.testnet.sui.io:443" });
const kit = createDAppKit({ networks: ["testnet"], createClient: () => client, autoConnect: false, slushWalletConfig: null });
const button = document.querySelector("mysten-dapp-kit-connect-button")!;
button.instance = kit;
let settings: OwnerConfig | undefined;
let isOwner = false;
let busy = false;
let revision = 0;
const note = document.querySelector<HTMLElement>("#wallet-status")!;

function updateButtons() {
  document.querySelector<HTMLFieldSetElement>("#owner-controls")!.disabled = !isOwner || busy;
}

export async function checkOwner() {
  const current = ++revision;
  isOwner = false;
  updateButtons();
  const account = kit.stores.$connection.get().account;
  if (!account || !settings) { note.textContent = "이 Allowance의 소유자 지갑을 연결하세요. 네트워크: Sui testnet"; return; }
  try {
    const { object } = await client.getObject({ objectId: settings.ownerCapId, include: { json: true } });
    if (current !== revision) return;
    const data = object.json as { allowance_id?: string } | null;
    isOwner = object.type === `${settings.packageId}::allowance::OwnerCap` &&
      object.owner.$kind === "AddressOwner" && object.owner.AddressOwner === account.address &&
      data?.allowance_id === settings.allowanceId && account.chains.includes("sui:testnet");
    note.textContent = isOwner ? "소유자 확인 완료. 변경할 때마다 지갑에서 서명합니다." : "연결한 계정이 이 Allowance의 소유자가 아니거나 testnet을 지원하지 않습니다.";
  } catch { if (current === revision) note.textContent = "소유권을 확인하지 못했습니다. 연결 상태를 확인하고 지갑을 다시 연결하세요."; }
  if (current === revision) updateButtons();
}

export async function initializeWallet(config: OwnerConfig) { settings = config; await checkOwner(); }

export async function ownerAction(action: OwnerAction) {
  if (!isOwner || !settings || busy) throw new Error("소유자 지갑 연결을 확인하세요.");
  busy = true;
  updateButtons();
  try {
    await checkOwner();
    if (!isOwner) throw new Error("소유권을 확인하지 못했습니다.");
    const result = await kit.signAndExecuteTransaction({ transaction: buildOwnerTransaction(settings, action) });
    if (result.$kind === "FailedTransaction") throw new Error("소유자 변경 트랜잭션이 실패했습니다.");
    const digest = result.Transaction.digest;
    note.replaceChildren(document.createTextNode("변경 트랜잭션 완료 · "));
    const link = document.createElement("a");
    link.href = `https://suiscan.xyz/testnet/tx/${digest}`;
    link.target = "_blank"; link.rel = "noreferrer"; link.textContent = "Sui에서 확인 ↗";
    note.append(link);
    return digest;
  } finally { busy = false; updateButtons(); }
}

kit.stores.$connection.subscribe(() => { void checkOwner(); });
