import { createAnthropicSession } from "./anthropic.js";
import { createGeminiSession } from "./gemini.js";
import { createOpenAISession } from "./openai.js";
import type { ModelSession, SessionOptions } from "./types.js";

export function createModelSession(options: SessionOptions): ModelSession {
  switch (options.provider.id) {
    case "anthropic": return createAnthropicSession(options);
    case "gemini": return createGeminiSession(options);
    case "openai": return createOpenAISession(options);
  }
}
