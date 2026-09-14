import { GoogleGenAI, type Interactions } from "@google/genai";
import { toolParameters } from "../agent-tools.js";
import { ChatExecutionError } from "../chat-errors.js";
import type { ModelSession, SessionOptions } from "./types.js";

export function createGeminiSession(options: SessionOptions, client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, vertexai: false })): ModelSession {
  const input: Interactions.Step[] = options.messages.map((m) => ({
    type: m.role === "user" ? "user_input" : "model_output", content: [{ type: "text", text: m.content }],
  }));
  return { async next(results) {
    input.push(...results.map((r) => ({ type: "function_result" as const, call_id: r.id, name: r.name,
      result: [{ type: "text" as const, text: r.output }], is_error: r.isError })));
    const response = await client.interactions.create({
      model: options.provider.model, system_instruction: options.system, input,
      store: false, generation_config: { max_output_tokens: 16000 },
      tools: options.tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description,
        parameters: toolParameters(tool) })),
    }, { timeout: 60_000, maxRetries: 0 });
    if (!["completed", "requires_action"].includes(response.status)) throw new ChatExecutionError("incomplete");
    if (response.steps.some((s) => s.type === "model_output" && s.error)) throw new ChatExecutionError("incomplete");
    // Keep every step, including thought signatures, verbatim for stateless continuation.
    input.push(...response.steps);
    return {
      text: response.steps.flatMap((s) => s.type === "model_output" ? (s.content ?? []).flatMap((c) => c.type === "text" ? [c.text] : []) : []).join("\n"),
      reasoning: response.steps.flatMap((s) => s.type === "thought" ? (s.summary ?? []).flatMap((c) => c.type === "text" ? [c.text] : []) : []).join("\n"),
      toolCalls: response.steps.flatMap((s) => s.type === "function_call" ? [{ id: s.id, name: s.name, input: s.arguments }] : []),
    };
  } };
}
