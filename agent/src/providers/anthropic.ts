import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { toolParameters } from "../agent-tools.js";
import { ChatExecutionError } from "../chat-errors.js";
import type { ModelSession, SessionOptions } from "./types.js";

export function createAnthropicSession(options: SessionOptions, client = new Anthropic({ maxRetries: 0, timeout: 120_000 })): ModelSession {
  const messages: BetaMessageParam[] = options.messages.map((m) => ({ ...m }));
  return { async next(results) {
    if (results.length) messages.push({ role: "user", content: results.map((r) => ({
      type: "tool_result", tool_use_id: r.id, content: r.output, is_error: r.isError,
    })) });
    const response = await client.beta.messages.create({
      model: options.provider.model, max_tokens: 16000,
      thinking: { type: "adaptive", display: "summarized" },
      system: options.system, messages,
      tools: options.tools.map((tool) => ({ name: tool.name, description: tool.description,
        input_schema: { ...toolParameters(tool), type: "object" as const } })),
    });
    if (!["end_turn", "tool_use", "refusal"].includes(response.stop_reason ?? "")) throw new ChatExecutionError("incomplete");
    messages.push({ role: "assistant", content: response.content });
    return {
      text: response.stop_reason === "refusal" ? "이 요청은 처리할 수 없습니다." : response.content.flatMap((b) => b.type === "text" ? [b.text] : []).join("\n"),
      reasoning: response.content.flatMap((b) => b.type === "thinking" ? [b.thinking] : []).join("\n"),
      toolCalls: response.stop_reason === "tool_use" ? response.content.flatMap((b) => b.type === "tool_use" ? [{ id: b.id, name: b.name, input: b.input }] : []) : [],
    };
  } };
}
