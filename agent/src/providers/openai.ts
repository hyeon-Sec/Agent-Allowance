import OpenAI from "openai";
import type { ResponseInput } from "openai/resources/responses/responses";
import { toolParameters } from "../agent-tools.js";
import { ChatExecutionError } from "../chat-errors.js";
import type { ModelSession, SessionOptions } from "./types.js";

export function createOpenAISession(options: SessionOptions, client = new OpenAI({ maxRetries: 0, timeout: 60_000 })): ModelSession {
  const input: ResponseInput = options.messages.map((m) => ({ ...m }));
  return { async next(results) {
    input.push(...results.map((r) => ({ type: "function_call_output" as const, call_id: r.id, output: r.output })));
    const response = await client.responses.create({
      model: options.provider.model, instructions: options.system, input,
      store: false, include: ["reasoning.encrypted_content"],
      max_output_tokens: 16000, parallel_tool_calls: false,
      tools: options.tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description,
        parameters: toolParameters(tool), strict: true })),
    });
    if (response.status !== "completed") throw new ChatExecutionError("incomplete");
    // Preserve encrypted reasoning and call IDs across stateless tool rounds.
    for (const item of response.output) {
      if (item.type !== "message" && item.type !== "reasoning" && item.type !== "function_call") throw new ChatExecutionError("invalid_response");
      input.push(item);
    }
    return {
      text: response.output.flatMap((item) => item.type === "message" ? item.content.flatMap((c) =>
        c.type === "output_text" ? [c.text] : c.type === "refusal" ? ["이 요청은 처리할 수 없습니다."] : []) : []).join("\n"),
      reasoning: response.output.flatMap((item) => item.type === "reasoning" ? item.summary.map((s) => s.text) : []).join("\n"),
      toolCalls: response.output.flatMap((item) => item.type === "function_call"
        ? [{ id: item.call_id, name: item.name, input: JSON.parse(item.arguments) as unknown }] : []),
    };
  } };
}
