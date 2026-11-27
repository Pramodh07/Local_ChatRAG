import type {
  AccountPreferences,
  ModelOption,
  ProviderModels,
  UsageBucket,
  UsageTotals,
} from "@/modules/account/types";
import {
  getLocalAccountPreferenceState,
  getLocalAccountPreferences,
  getLocalModelUsage,
  updateLocalAccountPreferences,
} from "@/modules/account/local-account-store";
import { listOllamaModels, listLocalProviderModels } from "@/modules/account/local-model-runtime";
import { isCatalogueModel } from "@/modules/account/model-catalogue";
import { parsePreferenceUpdate } from "@/modules/account/preferences-payload";
import { ServiceConfigurationError, ValidationError } from "@/modules/shared/lib/errors";
import { sumUsageBuckets } from "@/modules/account/usage";

type AccountServiceDependencies = {
  getPreferenceState: (
    accountId: string,
  ) => Promise<{ preferences: AccountPreferences; initialized: boolean }>;
  getPreferences: (accountId: string) => Promise<AccountPreferences>;
  updatePreferences: (
    accountId: string,
    update: Partial<AccountPreferences>,
  ) => Promise<AccountPreferences>;
  getUsage: (accountId: string) => Promise<UsageBucket[]>;
  listModels: () => Promise<ProviderModels[]>;
  listOllama: () => Promise<ModelOption[]>;
  isCatalogueModel: (provider: AccountPreferences["provider"], model: string) => boolean;
};

function isOllamaUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("fetch failed") || message.includes("timed out") || message.includes("Ollama");
}

export function createAccountService(overrides: Partial<AccountServiceDependencies> = {}) {
  const dependencies: AccountServiceDependencies = {
    getPreferenceState: getLocalAccountPreferenceState,
    getPreferences: getLocalAccountPreferences,
    updatePreferences: updateLocalAccountPreferences,
    getUsage: getLocalModelUsage,
    listModels: listLocalProviderModels,
    listOllama: listOllamaModels,
    isCatalogueModel,
    ...overrides,
  };

  return {
    async getModels() {
      return dependencies.listModels();
    },

    async getUsage(accountId: string): Promise<{ usage: UsageBucket[]; totals: UsageTotals }> {
      const usage = await dependencies.getUsage(accountId);
      return { usage, totals: sumUsageBuckets(usage) };
    },

    async getPreferences(accountId: string) {
      return dependencies.getPreferenceState(accountId);
    },

    async updatePreferences(
      accountId: string,
      payload: unknown,
    ): Promise<AccountPreferences> {
      const parsed = parsePreferenceUpdate(payload);
      if (!parsed.ok) throw new ValidationError(parsed.message);

      const update = parsed.value;
      const current = await dependencies.getPreferences(accountId);
      const next = { ...current, ...update };

      if ("provider" in update || "model" in update) {
        if (next.provider === "ollama") {
          let models;
          try {
            models = await dependencies.listOllama();
          } catch (error) {
            if (isOllamaUnavailable(error)) {
              throw new ServiceConfigurationError(
                "Could not verify the selected Ollama model. Start Ollama and try again.",
              );
            }
            throw error;
          }
          if (!models.some((model) => model.id === next.model)) {
            throw new ValidationError("Select a model currently installed in Ollama.");
          }
        } else if (!dependencies.isCatalogueModel(next.provider, next.model)) {
          throw new ValidationError("Select a supported model for the chosen provider.");
        }
      }

      try {
        return await dependencies.updatePreferences(accountId, update);
      } catch (error) {
        if (isOllamaUnavailable(error)) {
          throw new ServiceConfigurationError(
            "Could not verify the selected Ollama model. Start Ollama and try again.",
          );
        }
        throw error;
      }
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
