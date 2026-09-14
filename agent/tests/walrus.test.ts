import { test } from "node:test";
import assert from "node:assert/strict";
import { storeJson } from "../src/walrus.js";

const blobId = "A".repeat(43);
test("Walrus storage requests retention and verifies the exact uploaded bytes", async (t) => {
  let payload = "";
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    calls.push(init?.method ?? "GET");
    if (init?.method === "PUT") {
      assert.match(input, /permanent=true/);
      payload = String(init.body);
      return Response.json({ newlyCreated: { blobObject: { blobId, id: "object", storage: { endEpoch: 100 }, deletable: false } } });
    }
    return new Response(payload);
  });
  const result = await storeJson({ request: "lunch" });
  assert.deepEqual(calls, ["PUT", "GET"]);
  assert.equal(result.blobId, blobId);
  assert.equal(result.endEpoch, 100);
});
test("Walrus publisher errors are not treated as successful storage", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  await assert.rejects(storeJson({ request: "lunch" }), /HTTP 503/);
});
test("mismatched readback cannot authorize an application payment", async (t) => {
  t.mock.method(globalThis, "fetch", async (_input: string, init?: RequestInit) =>
    init?.method === "PUT" ? Response.json({ alreadyCertified: { blobId } }) : new Response("wrong data"));
  await assert.rejects(storeJson({ request: "lunch" }), /does not match/);
});
