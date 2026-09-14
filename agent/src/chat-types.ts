import type { Activity } from "./activity.js";
import type { AIProvider } from "./ai-config.js";

export interface ChatTurn { role: "user" | "assistant"; content: string; }
export interface ChatResult {
  reply: string;
  toolCalls: { name: string; input: unknown }[];
  payments: Activity[];
  provider?: AIProvider;
  model?: string;
}
export interface RunContext {
  provider: AIProvider;
  model: string;
  userRequest: string;
  lastReasoning: string;
  payments: Activity[];
  paymentAttempted: boolean;
  paymentUncertain: boolean;
}
