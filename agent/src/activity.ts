import fs from "node:fs";
import path from "node:path";

export type ActivityStatus = "approved" | "blocked" | "error" | "unknown";

export interface Activity {
  id: string;
  timestamp: number;
  allowanceId?: string;
  source: "agent" | "attack-sim" | "owner";
  status: ActivityStatus;
  recipient: string;
  recipientName?: string;
  amountSui: number;
  memo: string;
  reason?: string;
  digest?: string;
  logBlobId?: string;
  recordingError?: string;
  logEndEpoch?: number;
  logStorageEpochs?: number;
  failureStage?: "validation" | "audit" | "chain";
}

const FILE = path.resolve(process.env.ACTIVITY_FILE ?? "data/activity.json");

function load(): Activity[] {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!Array.isArray(data)) throw new Error("Invalid activity file");
    return data as Activity[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("결제 기록 파일을 읽지 못했습니다. 파일을 복구한 뒤 서버를 시작하세요.");
  }
}

const items: Activity[] = load();

export function recordActivity(entry: Omit<Activity, "id" | "timestamp">): Activity {
  const activity: Activity = { id: crypto.randomUUID(), timestamp: Date.now(), ...entry };
  items.unshift(activity);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const temporary = `${FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(items, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, FILE);
  return activity;
}

export function listActivity(): Activity[] {
  return items;
}
