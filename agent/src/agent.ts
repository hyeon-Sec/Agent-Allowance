import { z } from "zod";
import { getAIConfig, type AIProvider } from "./ai-config.js";
import { SYSTEM } from "./agent-prompt.js";
import { makeTools, defaultToolDependencies } from "./agent-tools.js";
import { ChatExecutionError, describeChatError } from "./chat-errors.js";
import { createModelSession } from "./providers/index.js";
import type { ToolResult } from "./providers/types.js";
import type { ChatTurn, ChatResult, RunContext } from "./chat-types.js";
export type { ChatTurn, ChatResult } from "./chat-types.js";

export const chatDependencies = { getAIConfig, createModelSession, tools: defaultToolDependencies };
export async function runChat(history: ChatTurn[], message: string, selectedProvider?: AIProvider,
  deps = chatDependencies): Promise<ChatResult> {
  const settings = deps.getAIConfig();
  const provider = settings.providers.find((p) => p.id === (selectedProvider ?? settings.defaultProvider));
  if (!provider) throw new ChatExecutionError("invalid_response");
  const ctx: RunContext = { provider: provider.id, model: provider.model, userRequest: message,
    lastReasoning: "", payments: [], paymentAttempted: false, paymentUncertain: false };
  const toolCalls: ChatResult["toolCalls"] = [];
  const result = (reply: string): ChatResult => ({ reply, toolCalls, payments: ctx.payments, provider: provider.id, model: provider.model });
  try {
    if (!provider.available) throw new ChatExecutionError("missing_key");
    const tools = makeTools(ctx, deps.tools);
    const toolByName = new Map(tools.map((t) => [t.name, t]));
    const session = deps.createModelSession({ provider, system: SYSTEM, messages: [...history, { role: "user", content: message }], tools });
    const completed = new Map<string, { fingerprint: string; result: ToolResult }>();
    let results: ToolResult[] = [];
    for (let round = 0; round < 10; round++) {
      const turn = await session.next(results);
      ctx.lastReasoning = turn.reasoning.trim() || turn.text.trim();
      if (!turn.toolCalls.length) {
        if (!turn.text.trim()) throw new ChatExecutionError("invalid_response");
        return result(turn.text.trim());
      }
      // Leave a model round for the final receipt explanation; never execute a truncated response.
      if (round === 9 || toolCalls.length + turn.toolCalls.length > 40) throw new ChatExecutionError("tool_limit");
      results = [];
      for (const call of turn.toolCalls) {
        if (!call.id || !call.name) throw new ChatExecutionError("invalid_response");
        const fingerprint = JSON.stringify([call.name, call.input]);
        const prior = completed.get(call.id);
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw new ChatExecutionError("invalid_response");
          results.push(prior.result); continue;
        }
        toolCalls.push({ name: call.name, input: call.input });
        const tool = toolByName.get(call.name);
        let output: string;
        let isError = false;
        try {
          if (!tool) { output = "허용되지 않은 도구입니다."; isError = true; }
          else output = await tool.run(call.input);
        } catch (error) {
          if (!(error instanceof z.ZodError)) throw error;
          output = "도구 입력 형식이 올바르지 않습니다. 정의된 필드와 금액을 확인하세요."; isError = true;
        }
        const toolResult = { id: call.id, name: call.name, output, isError };
        completed.set(call.id, { fingerprint, result: toolResult });
        results.push(toolResult);
      }
    }
    throw new ChatExecutionError("tool_limit");
  } catch (error) {
    // Keep receipts after provider failure. No automatic retry or provider failover.
    return result(describeChatError(error, ctx.paymentAttempted, provider.id));
  }
}
