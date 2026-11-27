"use client";

import { useEffect, useState } from "react";
import type { AccountPreferences, ModelProvider } from "@/modules/account/types";
import { isModelProvider } from "@/modules/account/types";
import { Button } from "@/modules/shared/components/ui/button";
import { Card, CardHeader } from "@/modules/shared/components/ui/card";
import { Field, Select } from "@/modules/shared/components/ui/field";
import { Notice } from "@/modules/shared/components/ui/notice";
import { KeyRound } from "@/modules/shared/components/icons";
import { isRecord } from "@/modules/shared/lib/guards";
import { errorMessageFromPayload } from "@/modules/shared/lib/http";

const providerOptions: Array<{ value: ModelProvider; label: string }> = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google Gemini" },
  { value: "ollama", label: "Ollama (local)" },
];

export function ProviderApiKeySection({
  preferences,
  localMode,
}: {
  account: { id: string };
  preferences: AccountPreferences;
  localMode: boolean;
}) {
  const [provider, setProvider] = useState<ModelProvider>(preferences.provider);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    setProvider(preferences.provider);
  }, [preferences.provider]);

  async function testConnection() {
    setTesting(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/account/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(errorMessageFromPayload(payload, "The provider connection failed."));
      }
      if (!isRecord(payload) || payload.connected !== true) {
        throw new Error("The provider connection response was invalid.");
      }
      setFeedback({ tone: "success", message: "Connection successful." });
    } catch (testError) {
      setFeedback({
        tone: "error",
        message: testError instanceof Error ? testError.message : "The provider connection failed.",
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <div className="p-5 sm:p-6">
        <CardHeader
          icon={<KeyRound size={16} />}
          title="Provider connection"
          description="Provider credentials are configured on the server. Verify that a provider is reachable."
        />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Provider" htmlFor="provider-connection-provider">
            <Select
              id="provider-connection-provider"
              value={provider}
              onChange={(event) => {
                if (isModelProvider(event.target.value)) setProvider(event.target.value);
              }}
            >
              {(localMode ? providerOptions : providerOptions.filter((option) => option.value !== "ollama")).map(
                (option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ),
              )}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button
              variant="secondary"
              onClick={() => void testConnection()}
              loading={testing}
              disabled={testing}
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted">
          Keys are read from server environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY,
          GOOGLE_API_KEY or GEMINI_API_KEY) or from Ollama at OLLAMA_BASE_URL. They are never
          stored in this browser or sent to the server by the UI. Document retrieval always
          embeds with OpenAI on the server.
        </p>
        {feedback && (
          <div className="mt-4">
            <Notice tone={feedback.tone}>{feedback.message}</Notice>
          </div>
        )}
      </div>
    </Card>
  );
}
