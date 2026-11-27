"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import type { ChatRuntimeSettings } from "@/modules/chat/runtime-settings";
import {
  DEFAULT_CHAT_RUNTIME_SETTINGS,
  getStoredChatRuntimeSettings,
  isChatRuntimeSettings,
  storeChatRuntimeSettings,
} from "@/modules/chat/runtime-settings";
import { Button } from "@/modules/shared/components/ui/button";
import { Card, CardHeader } from "@/modules/shared/components/ui/card";
import { Field, Input } from "@/modules/shared/components/ui/field";
import { Notice } from "@/modules/shared/components/ui/notice";
import { Cpu, Database } from "@/modules/shared/components/icons";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";

type SettingsDraft = Record<keyof ChatRuntimeSettings, string>;

function toSettingsDraft(settings: ChatRuntimeSettings): SettingsDraft {
  return {
    temperature: String(settings.temperature),
    maxTokens: String(settings.maxTokens),
    topK: String(settings.topK),
    chunkSize: String(settings.chunkSize),
    similarityThreshold: String(settings.similarityThreshold),
  };
}

function parseSettingsDraft(draft: SettingsDraft): ChatRuntimeSettings {
  return {
    temperature: Number(draft.temperature),
    maxTokens: Number(draft.maxTokens),
    topK: Number(draft.topK),
    chunkSize: Number(draft.chunkSize),
    similarityThreshold: Number(draft.similarityThreshold),
  };
}

export function ChatRuntimeSettingsSection({ accountId }: { accountId: string }) {
  const [draft, setDraft] = useState<SettingsDraft>(toSettingsDraft(DEFAULT_CHAT_RUNTIME_SETTINGS));
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setDraft(toSettingsDraft(DEFAULT_CHAT_RUNTIME_SETTINGS));
    setError(null);
    setSaved(false);
    try {
      setDraft(toSettingsDraft(getStoredChatRuntimeSettings(accountId)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chat settings could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  function updateNumber(key: keyof ChatRuntimeSettings, event: ChangeEvent<HTMLInputElement>) {
    setDraft((current) => ({ ...current, [key]: event.target.value }));
    setSaved(false);
  }

  function saveSettings() {
    setError(null);
    setSaved(false);
    if (Object.values(draft).some((value) => !value.trim())) {
      setError("Complete each settings field with a valid value before saving.");
      return;
    }
    const settings = parseSettingsDraft(draft);
    if (!isChatRuntimeSettings(settings)) {
      setError("Use a temperature and similarity threshold from 0 to 1, 128–4096 output tokens, 1–20 results, and a 400–4000 character chunk size.");
      return;
    }
    try {
      storeChatRuntimeSettings(accountId, settings);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Chat settings could not be saved.");
    }
  }

  function reloadSettings() {
    try {
      setDraft(toSettingsDraft(getStoredChatRuntimeSettings(accountId)));
      setError(null);
      setSaved(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chat settings could not be loaded.");
    }
  }

  function resetSettings() {
    const defaults = { ...DEFAULT_CHAT_RUNTIME_SETTINGS };
    try {
      storeChatRuntimeSettings(accountId, defaults);
      setDraft(toSettingsDraft(defaults));
      setError(null);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Chat settings could not be reset.");
    }
  }

  function isInvalid(key: keyof ChatRuntimeSettings) {
    if (!draft[key].trim()) return true;
    const value = Number(draft[key]);
    switch (key) {
      case "temperature":
      case "similarityThreshold":
        return !Number.isFinite(value) || value < 0 || value > 1;
      case "maxTokens":
        return !Number.isSafeInteger(value) || value < 128 || value > 4096;
      case "topK":
        return !Number.isSafeInteger(value) || value < 1 || value > 20;
      case "chunkSize":
        return !Number.isSafeInteger(value) || value < 400 || value > 4000;
    }
  }

  if (loading) {
    return (
      <Card>
        <div className="space-y-3 p-5 sm:p-6" role="status" aria-label="Loading chat settings">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-5 sm:p-6">
        <CardHeader
          icon={<Cpu size={16} />}
          title="Model parameters"
          description="Control response length and variation for the next request."
        />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Temperature" htmlFor="chat-temperature" hint="0 is more consistent; 1 allows more variation.">
            <Input
              id="chat-temperature"
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={draft.temperature}
              onChange={(event) => updateNumber("temperature", event)}
              invalid={isInvalid("temperature")}
            />
          </Field>
          <Field label="Maximum output tokens" htmlFor="chat-max-tokens" hint="Allowed range: 128–4096 tokens.">
            <Input
              id="chat-max-tokens"
              type="number"
              min={128}
              max={4096}
              step={128}
              value={draft.maxTokens}
              onChange={(event) => updateNumber("maxTokens", event)}
              invalid={isInvalid("maxTokens")}
            />
          </Field>
        </div>

        <div className="mt-6 border-t border-line pt-5">
          <CardHeader
            icon={<Database size={16} />}
            title="Retrieval"
            description="Tune passage selection and the chunk size used for new uploads."
          />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Top results" htmlFor="retrieval-top-k" hint="Allowed range: 1–20 passages.">
              <Input
                id="retrieval-top-k"
                type="number"
                min={1}
                max={20}
                step={1}
                value={draft.topK}
                onChange={(event) => updateNumber("topK", event)}
                invalid={isInvalid("topK")}
              />
            </Field>
            <Field label="Similarity threshold" htmlFor="retrieval-threshold" hint="Passages below this score are excluded.">
              <Input
                id="retrieval-threshold"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={draft.similarityThreshold}
                onChange={(event) => updateNumber("similarityThreshold", event)}
                invalid={isInvalid("similarityThreshold")}
              />
            </Field>
            <Field label="Chunk size" htmlFor="document-chunk-size" hint="400–4000 characters; applies only to future uploads.">
              <Input
                id="document-chunk-size"
                type="number"
                min={400}
                max={4000}
                step={100}
                value={draft.chunkSize}
                onChange={(event) => updateNumber("chunkSize", event)}
                invalid={isInvalid("chunkSize")}
              />
            </Field>
            <Field label="Embedding model" htmlFor="embedding-model" hint="Existing documents keep their current vectors.">
              <Input id="embedding-model" value="text-embedding-3-small" readOnly aria-readonly="true" />
            </Field>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted">
            Chunk size changes affect new uploads only. Atlas does not retain original files, so existing documents must be uploaded again to rebuild their index.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={saveSettings}>
            Save settings
          </Button>
          {saved && <span className="text-sm text-ok" role="status">Saved in this browser.</span>}
        </div>
        {error && (
          <div className="mt-4">
            <Notice tone="error">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={reloadSettings}>Retry</Button>
                  <Button size="sm" variant="secondary" onClick={resetSettings}>Reset to defaults</Button>
                </div>
              </div>
            </Notice>
          </div>
        )}
      </div>
    </Card>
  );
}
