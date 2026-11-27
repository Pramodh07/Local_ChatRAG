import type { Theme } from "@/modules/shared/lib/theme";
import { isOneOf } from "@/modules/shared/lib/guards";

export const MODEL_PROVIDERS = ["openai", "anthropic", "google", "ollama"] as const;

export type ModelProvider = (typeof MODEL_PROVIDERS)[number];
export type AppearanceTheme = Theme;

export function isModelProvider(value: unknown): value is ModelProvider {
  return isOneOf(value, MODEL_PROVIDERS);
}

export type AccountPreferences = {
  provider: ModelProvider;
  model: string;
  theme: AppearanceTheme;
};

export type UsageBucket = {
  date: string;
  provider: ModelProvider;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  costEstimateComplete: boolean;
};

export type UsageTotals = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  costEstimateComplete: boolean;
};

export type ModelOption = {
  id: string;
  name: string;
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
};

export type ProviderModels = {
  id: ModelProvider;
  name: string;
  configured: boolean;
  models: ModelOption[];
  message?: string;
};
