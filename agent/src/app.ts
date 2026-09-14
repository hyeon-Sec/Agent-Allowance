import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { listActivity, type Activity } from "./activity.js";
import { runChat } from "./agent.js";
import { getAIConfig, PROVIDERS } from "./ai-config.js";
import { config, env } from "./config.js";
import { MERCHANTS, findMerchant } from "./merchants.js";
import { executePayment } from "./payments.js";
import { agentSigner, getAllowanceStatus } from "./sui.js";
import { blobUrl } from "./walrus.js";

const chatSchema = z.object({
  provider: z.enum(PROVIDERS).optional(),
  requestId: z.string().uuid(), message: z.string().trim().min(1).max(4000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(30).default([]),
});
const attackSchema = z.object({ requestId: z.string().uuid() });
const attacks = new Map([
  ["drain", { recipient: "campus-store", amountSui: 5, memo: "탈취 키로 1회 한도 초과 송금 시도" }],
  ["exfiltrate", { recipient: findMerchant("lucky-coupon")!.address, amountSui: 0.05, memo: "탈취 키로 공격자 주소에 송금 시도" }],
]);

const withLinks = (a: Activity) => ({
  ...a, txUrl: a.digest ? config.explorerTx(a.digest) : undefined,
  logUrl: a.logBlobId ? blobUrl(a.logBlobId) : undefined,
});

export function createApp(deps = {
  runChat, executePayment, getAllowanceStatus, listActivity,
  agentAddress: () => agentSigner().toSuiAddress(),
}, aiConfig = getAIConfig) {
  const app = express();
  app.disable("x-powered-by");
  // This single-user demo is loopback-only. Reject DNS rebinding and cross-site requests.
  app.use((req, res, next) => {
    const allowedHosts = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`];
    if (!allowedHosts.includes(req.headers.host ?? "")) {
      res.status(403).json({ error: "로컬 주소로 접속하세요." }); return;
    }
    const origin = req.headers.origin;
    if ((origin && origin !== `http://${req.headers.host}`) || req.headers["sec-fetch-site"] === "cross-site") {
      res.status(403).json({ error: "외부 사이트의 요청은 허용하지 않습니다." }); return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.use(express.static(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web")));

  app.get("/api/config", (_req, res) => {
    const ai = aiConfig();
    res.json({
      network: "testnet", packageId: env("PACKAGE_ID"), allowanceId: env("ALLOWANCE_ID"),
      ownerCapId: env("OWNER_CAP_ID"),
      ...ai, chatAvailable: ai.providers.some((p) => p.available),
    });
  });
  app.get("/api/status", async (_req, res) => {
    const status = await deps.getAllowanceStatus();
    res.json({
      ...status, agentAddress: deps.agentAddress(), allowanceUrl: config.explorerObject(status.allowanceId),
      merchants: MERCHANTS.map((m) => ({
        id: m.id, name: m.name, address: m.address, allowed: status.allowedRecipients.includes(m.address),
      })),
    });
  });
  app.get("/api/activity", (_req, res) => res.json(deps.listActivity()
    .filter((a) => a.allowanceId === env("ALLOWANCE_ID") || !a.allowanceId)
    .slice(0, 100).map(withLinks)));

  let active = false;
  const completed = new Map<string, { fingerprint: string; result: unknown }>();
  async function exclusive(req: Request, res: Response, requestId: string, task: () => Promise<unknown>) {
    const fingerprint = JSON.stringify([req.path, req.body]);
    const prior = completed.get(requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) res.status(409).json({ error: "이미 사용한 요청 ID입니다." });
      else res.json(prior.result);
      return;
    }
    if (active) { res.status(409).json({ error: "이전 요청이 처리 중입니다. 결과를 확인한 뒤 진행하세요." }); return; }
    active = true;
    try {
      const result = await task();
      completed.set(requestId, { fingerprint, result });
      if (completed.size > 100) completed.delete(completed.keys().next().value!);
      res.json(result);
    } finally { active = false; }
  }

  app.post("/api/chat", async (req, res) => {
    const { requestId, message, history, provider } = chatSchema.parse(req.body);
    await exclusive(req, res, requestId, async () => {
      const result = await deps.runChat(history, message, provider ?? aiConfig().defaultProvider);
      return { ...result, payments: result.payments.map(withLinks) };
    });
  });
  app.post("/api/attack/:kind", async (req, res) => {
    const attack = attacks.get(String(req.params.kind));
    if (!attack) { res.status(404).json({ error: "알 수 없는 시뮬레이션입니다." }); return; }
    const { requestId } = attackSchema.parse(req.body);
    await exclusive(req, res, requestId, async () => withLinks(await deps.executePayment({
      source: "attack-sim", ...attack,
      decision: { note: "Simulated compromised agent key: bypasses the LLM and calls spend directly" },
    })));
  });
  // Owner transactions are built and signed exclusively in the browser wallet.
  app.use("/api", (_req, res) => res.status(404).json({ error: "존재하지 않는 API입니다." }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError || (err as { status?: number })?.status === 400) {
      res.status(400).json({ error: "요청 형식이나 입력값이 올바르지 않습니다." }); return;
    }
    console.error("API request failed:", err instanceof Error ? err.name : "UnknownError");
    res.status(500).json({ error: "요청을 완료하지 못했습니다. 결제 요청이었다면 기록을 확인한 뒤 진행하세요." });
  });
  return app;
}
