import type { ModelOption, ModelProvider } from "@/modules/account/types";

/** Static, client-safe model catalogue (no server-only dependencies). */
export const MODEL_CATALOGUE: Record<Exclude<ModelProvider, "ollama">, ModelOption[]> = {
  openai: [
    { id: "gpt-6.2-sol", name: "GPT-6.2 Sol", inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
    { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
    { id: "gpt-6-luna", name: "GPT-6 Luna", inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
  ],
  anthropic: [
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
    { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
    { id: "claude-opus-5-5", name: "Claude Opus 5.5", inputUsdPerMillion: 4, outputUsdPerMillion: 20 },
  ],
  google: [
    { id: "gemini-4-argon", name: "Gemini 4 Argon", inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
    { id: "gemini-4-carbon", name: "Gemini 4 Carbon", inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
  ],
};

export const PROVIDER_NAMES: Record<ModelProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  ollama: "Ollama",
};
