import { config } from "./config.js";
import { setTimeout as delay } from "node:timers/promises";

export interface StoredLog {
  blobId: string;
  blobObjectId?: string;
  endEpoch?: number;
  storageEpochs: number;
}

interface StoreResponse {
  newlyCreated?: { blobObject: { id?: string; blobId: string; storage?: { endEpoch?: number }; deletable?: boolean } };
  alreadyCertified?: { blobId: string; endEpoch?: number };
}

/** Stores a JSON document on Walrus and returns its blob ID. */
export async function storeJson(data: unknown): Promise<StoredLog> {
  const payload = JSON.stringify(data, null, 2);
  const res = await fetch(`${config.walrusPublisher}/v1/blobs?epochs=${config.walrusEpochs}&permanent=true`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: payload,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Walrus store failed: HTTP ${res.status}`);
  const body = (await res.json()) as StoreResponse;
  const blobId = body.newlyCreated?.blobObject.blobId ?? body.alreadyCertified?.blobId;
  if (!blobId || !/^[A-Za-z0-9_-]{43}$/.test(blobId)) throw new Error("Walrus returned an invalid blob ID");
  if (body.newlyCreated?.blobObject.deletable === true) throw new Error("Walrus returned a deletable blob");
  // Newly certified blobs can take a short time to propagate to the aggregator.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (await readBlob(blobId) !== payload) throw new Error("Walrus record does not match the decision");
      break;
    } catch (err) {
      if (attempt === 2) throw err;
      await delay(500 * 2 ** attempt);
    }
  }
  return {
    blobId, blobObjectId: body.newlyCreated?.blobObject.id,
    endEpoch: body.newlyCreated?.blobObject.storage?.endEpoch ?? body.alreadyCertified?.endEpoch,
    storageEpochs: config.walrusEpochs,
  };
}

export async function readBlob(blobId: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(blobId)) throw new Error("Invalid Walrus blob ID");
  const res = await fetch(blobUrl(blobId), { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`Walrus read failed: HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 256_000) throw new Error("Walrus record is too large");
  return text;
}

export function blobUrl(blobId: string): string {
  return `${config.walrusAggregator}/v1/blobs/${encodeURIComponent(blobId)}`;
}
