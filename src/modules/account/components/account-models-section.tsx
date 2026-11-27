"use client";

import { useEffect, useState } from "react";
import { Cpu, Sparkle } from "@/modules/shared/components/icons";
import { LoadingState } from "@/modules/account/components/account-ui";
import type {
  AccountPreferences,
  ModelOption,
  ModelProvider,
  ProviderModels,
} from "@/modules/account/types";
import { isModelProvider } from "@/modules/account/types";
import { MODEL_CATALOGUE, PROVIDER_NAMES } from "@/modules/account/model-options";
import { Button } from "@/modules/shared/components/ui/button";
import { Card, CardHeader } from "@/modules/shared/components/ui/card";
import { Select } from "@/modules/shared/components/ui/field";
import { Notice } from "@/modules/shared/components/ui/notice";

type AccountModelsSectionProps = {
  providers: ProviderModels[];
  preferences: AccountPreferences;
  selectedProvider: ProviderModels | undefined;
  selectedModel: ModelOption | undefined;
  localMode: boolean;
  loading: boolean;
  saving: boolean;
  onChooseProvider: (provider: ModelProvider) => void;
  onChangeModel: (model: string) => void;
  onSaveModel: () => void;
};

const MODEL_PREFERENCE_KEY = "atlas-chat-model-preference";

/** Supabase accounts select an answer model locally; keys stay server-side. */
function SupabaseModelSection() {
  const [provider, setProvider] = useState<keyof typeof MODEL_CATALOGUE>("openai");
  const [model, setModel] = useState<string>(MODEL_CATALOGUE.openai[0]?.id ?? "");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MODEL_PREFERENCE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return;
      const saved = parsed as { provider?: string; model?: string };
      if (saved.provider && saved.provider in MODEL_CATALOGUE) {
        const nextProvider = saved.provider as keyof typeof MODEL_CATALOGUE;
        setProvider(nextProvider);
        if (saved.model && MODEL_CATALOGUE[nextProvider].some((item) => item.id === saved.model)) {
          setModel(saved.model);
        }
      }
    } catch {
      // Ignore malformed local preferences.
    }
  }, []);

  function save(nextProvider: keyof typeof MODEL_CATALOGUE, nextModel: string) {
    setProvider(nextProvider);
    setModel(nextModel);
    localStorage.setItem(MODEL_PREFERENCE_KEY, JSON.stringify({ provider: nextProvider, model: nextModel }));
  }

  const models = MODEL_CATALOGUE[provider];

  return (
    <Card>
      <div className="p-5 sm:p-6">
        <CardHeader
          icon={<Cpu size={15} />}
          title="Answer model"
          description="Choose the model used to answer questions. Retrieval embeddings always run on OpenAI."
        />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="rag-provider" className="mb-1.5 block text-[12.5px] font-medium text-muted">
              Provider
            </label>
            <Select
              id="rag-provider"
              value={provider}
              onChange={(event) => {
                const next = event.target.value as keyof typeof MODEL_CATALOGUE;
                if (next in MODEL_CATALOGUE) save(next, MODEL_CATALOGUE[next][0]?.id ?? "");
              }}
            >
              {Object.keys(MODEL_CATALOGUE).map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_NAMES[id as keyof typeof PROVIDER_NAMES]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="rag-model" className="mb-1.5 block text-[12.5px] font-medium text-muted">
              Model
            </label>
            <Select
              id="rag-model"
              value={model}
              onChange={(event) => save(provider, event.target.value)}
            >
              {models.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </Select>
          </div>
        </div>
        <div className="mt-4">
          <Notice tone="info">
            Saved on this device. Provider keys are read from server environment variables.
          </Notice>
        </div>
      </div>
    </Card>
  );
}

export function AccountModelsSection({
  providers,
  preferences,
  selectedProvider,
  selectedModel,
  localMode,
  loading,
  saving,
  onChooseProvider,
  onChangeModel,
  onSaveModel,
}: AccountModelsSectionProps) {
  if (!localMode) return <SupabaseModelSection />;
  if (loading) return <LoadingState />;

  return (
    <div className="space-y-5">
      <Card>
        <div className="p-5 sm:p-6">
          <CardHeader
            icon={<Cpu size={15} />}
            title="Provider"
            description="Credentials are read from server environment variables and never saved in your account file."
          />

          <div className="mt-5 max-w-sm">
            <label htmlFor="provider" className="mb-1.5 block text-[12.5px] font-medium text-muted">
              Active provider
            </label>
            <Select
              id="provider"
              value={preferences.provider}
              onChange={(event) => {
                if (isModelProvider(event.target.value)) onChooseProvider(event.target.value);
              }}
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </Select>
          </div>

          {selectedProvider && (
            <div className="mt-4 max-w-sm">
              <Notice tone={selectedProvider.configured ? "success" : "warning"}>
                <span className="font-medium">
                  {selectedProvider.configured ? "Ready to use." : "Not configured."}
                </span>{" "}
                {selectedProvider.message ??
                  `${selectedProvider.models.length} model${selectedProvider.models.length === 1 ? "" : "s"} available.`}
              </Notice>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="p-5 sm:p-6">
          <CardHeader
            icon={<Sparkle size={15} />}
            title="Model"
            description="Local-development chat uses this model without document retrieval."
          />

          <div className="mt-5 max-w-sm">
            <label htmlFor="model" className="mb-1.5 block text-[12.5px] font-medium text-muted">
              Active model
            </label>
            <Select
              id="model"
              value={preferences.model}
              disabled={!selectedProvider?.models.length}
              onChange={(event) => onChangeModel(event.target.value)}
            >
              {selectedProvider?.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </Select>
          </div>

          {!selectedProvider?.models.length && (
            <p className="mt-3 text-[11.5px] leading-5 text-muted">
              {selectedProvider?.message ?? "No models are available."}
            </p>
          )}
          {selectedModel && (
            <p className="mt-3 text-[11.5px] leading-5 text-muted">
              {selectedModel.inputUsdPerMillion === null || selectedModel.outputUsdPerMillion === null
                ? "No standard price estimate is available for this model."
                : preferences.provider === "ollama"
                  ? "No provider token fee is estimated. Local hardware costs are not included."
                  : `Standard rate: $${selectedModel.inputUsdPerMillion}/1M input tokens · $${selectedModel.outputUsdPerMillion}/1M output tokens.`}
            </p>
          )}
          {preferences.provider === "google" && (
            <div className="mt-3">
              <Notice tone="warning">
                Google lists a standard-rate change for these models starting December 1, 2026.
              </Notice>
            </div>
          )}

          <Button
            variant="primary"
            className="mt-5"
            disabled={
              saving ||
              !preferences.model ||
              !selectedProvider?.models.some((model) => model.id === preferences.model)
            }
            loading={saving}
            onClick={onSaveModel}
          >
            {saving ? "Saving…" : "Save model"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
