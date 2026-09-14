import "./config.js";

export const PROVIDERS = ["anthropic", "gemini", "openai"] as const;
export type AIProvider = typeof PROVIDERS[number];
export interface ProviderOption {
  id: AIProvider;
  label: string;
  model: string;
  available: boolean;
  keyEnv: string;
}

/** Public configuration only: never return credentials to the browser. */
export function getAIConfig(values: NodeJS.ProcessEnv = process.env) {
  const providers: ProviderOption[] = [
    { id: "anthropic", label: "Claude", model: values.ANTHROPIC_MODEL?.trim() || "claude-opus-5",
      available: Boolean(values.ANTHROPIC_API_KEY?.trim() || values.ANTHROPIC_AUTH_TOKEN?.trim()), keyEnv: "ANTHROPIC_API_KEY" },
    { id: "gemini", label: "Gemini", model: values.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
      available: Boolean(values.GEMINI_API_KEY?.trim()), keyEnv: "GEMINI_API_KEY" },
    { id: "openai", label: "OpenAI (Codex)", model: values.OPENAI_MODEL?.trim() || "gpt-5.3-codex",
      available: Boolean(values.OPENAI_API_KEY?.trim()), keyEnv: "OPENAI_API_KEY" },
  ];
  const defaultProvider = values.AI_PROVIDER?.trim() || "anthropic";
  if (!PROVIDERS.includes(defaultProvider as AIProvider)) throw new Error("AI_PROVIDER must be anthropic, gemini, or openai");
  return { defaultProvider: defaultProvider as AIProvider, providers };
}
