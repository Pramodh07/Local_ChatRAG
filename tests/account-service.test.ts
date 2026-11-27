import { describe, expect, it, vi } from "vitest";
import type { AccountPreferences, UsageBucket } from "@/modules/account/types";
import { createAccountService } from "@/modules/account/account-service";
import { ServiceConfigurationError, ValidationError } from "@/modules/shared/lib/errors";

const preferences: AccountPreferences = {
  provider: "openai",
  model: "gpt-6.2-sol",
  theme: "light",
};

const usage: UsageBucket[] = [
  {
    date: "2026-11-20",
    provider: "openai",
    model: "gpt-6.2-sol",
    requests: 3,
    inputTokens: 30,
    outputTokens: 60,
    estimatedCostUsd: 0.5,
    costEstimateComplete: true,
  },
  {
    date: "2026-11-19",
    provider: "ollama",
    model: "llama",
    requests: 1,
    inputTokens: 1,
    outputTokens: 2,
    estimatedCostUsd: 0,
    costEstimateComplete: false,
  },
];

function createDependencies() {
  return {
    getPreferenceState: vi.fn(async () => ({ preferences, initialized: true })),
    getPreferences: vi.fn(async () => preferences),
    updatePreferences: vi.fn(async (_accountId: string, update: Partial<AccountPreferences>) => ({
      ...preferences,
      ...update,
    })),
    getUsage: vi.fn(async () => usage),
    listModels: vi.fn(async () => []),
    listOllama: vi.fn(async () => []),
    isCatalogueModel: vi.fn(() => true),
  };
}

describe("account service", () => {
  it("returns usage with summed totals", async () => {
    const service = createAccountService(createDependencies());

    await expect(service.getUsage("account-1")).resolves.toEqual({
      usage,
      totals: {
        requests: 4,
        inputTokens: 31,
        outputTokens: 62,
        estimatedCostUsd: 0.5,
        costEstimateComplete: false,
      },
    });
  });

  it("returns the preference state including initialization", async () => {
    const service = createAccountService(createDependencies());
    await expect(service.getPreferences("account-1")).resolves.toEqual({
      preferences,
      initialized: true,
    });
  });

  it("accepts a theme-only update", async () => {
    const dependencies = createDependencies();
    const service = createAccountService(dependencies);

    await expect(service.updatePreferences("account-1", { theme: "dark" })).resolves.toEqual({
      ...preferences,
      theme: "dark",
    });
    expect(dependencies.updatePreferences).toHaveBeenCalledWith("account-1", { theme: "dark" });
  });

  it("accepts a catalogue provider/model pair", async () => {
    const dependencies = createDependencies();
    const service = createAccountService(dependencies);

    await service.updatePreferences("account-1", {
      provider: "anthropic",
      model: "claude-sonnet-5-5",
    });

    expect(dependencies.isCatalogueModel).toHaveBeenCalledWith(
      "anthropic",
      "claude-sonnet-5-5",
    );
    expect(dependencies.updatePreferences).toHaveBeenCalledWith("account-1", {
      provider: "anthropic",
      model: "claude-sonnet-5-5",
    });
  });

  it("rejects a model outside the catalogue", async () => {
    const dependencies = createDependencies();
    dependencies.isCatalogueModel.mockReturnValue(false);
    const service = createAccountService(dependencies);

    await expect(
      service.updatePreferences("account-1", { provider: "openai", model: "unknown" }),
    ).rejects.toThrow("Select a supported model for the chosen provider.");
    expect(dependencies.updatePreferences).not.toHaveBeenCalled();
  });

  it("requires the selected Ollama model to be installed", async () => {
    const dependencies = createDependencies();
    const service = createAccountService(dependencies);

    await expect(
      service.updatePreferences("account-1", { provider: "ollama", model: "missing" }),
    ).rejects.toThrow("Select a model currently installed in Ollama.");
  });

  it("maps an Ollama connection failure to a 503", async () => {
    const dependencies = createDependencies();
    dependencies.listOllama.mockRejectedValue(new Error("fetch failed"));
    const service = createAccountService(dependencies);

    await expect(
      service.updatePreferences("account-1", { provider: "ollama", model: "llama" }),
    ).rejects.toBeInstanceOf(ServiceConfigurationError);
  });

  it("rejects malformed preference payloads with validation errors", async () => {
    const dependencies = createDependencies();
    const service = createAccountService(dependencies);

    await expect(
      service.updatePreferences("account-1", { provider: "openai" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.updatePreferences("account-1", { theme: "dark", unknown: true }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
