import "server-only";

import type { ModelProvider } from "@/modules/account/types";

export { MODEL_CATALOGUE, PROVIDER_NAMES } from "@/modules/account/model-options";
import { MODEL_CATALOGUE } from "@/modules/account/model-options";

export function isCatalogueModel(provider: ModelProvider, model: string): boolean {
  if (provider === "ollama") return model.length > 0 && model.length <= 200;
  return MODEL_CATALOGUE[provider].some((option) => option.id === model);
}

export function getModelPricing(
  provider: ModelProvider,
  model: string,
  date = new Date(),
): { inputUsdPerMillion: number; outputUsdPerMillion: number } | null {
  if (provider === "ollama") return { inputUsdPerMillion: 0, outputUsdPerMillion: 0 };
  const option = MODEL_CATALOGUE[provider].find((item) => item.id === model);
  if (!option) return null;
  if (option.inputUsdPerMillion === null || option.outputUsdPerMillion === null) return null;

  if (provider === "google" && date >= new Date("2026-12-01T00:00:00.000Z")) {
    return { inputUsdPerMillion: 4, outputUsdPerMillion: 20 };
  }
  return {
    inputUsdPerMillion: option.inputUsdPerMillion,
    outputUsdPerMillion: option.outputUsdPerMillion,
  };
}

export function estimateModelCostUsd(
  provider: ModelProvider,
  model: string,
  inputTokens: number,
  outputTokens: number,
  date = new Date(),
): number | null {
  const pricing = getModelPricing(provider, model, date);
  if (!pricing) return null;
  return (
    (inputTokens * pricing.inputUsdPerMillion + outputTokens * pricing.outputUsdPerMillion) /
    1_000_000
  );
}
