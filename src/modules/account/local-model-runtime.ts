import "server-only";

import { getOpenAI } from "@/modules/shared/integrations/openai";
import type { ChatHistoryTurn } from "@/modules/chat/types";
import type { ModelProvider, ModelOption, ProviderModels } from "@/modules/account/types";
import {
  MODEL_CATALOGUE,
  PROVIDER_NAMES,
} from "@/modules/account/model-catalogue";
import { isRecord } from "@/modules/shared/lib/guards";
import type { ChatRuntimeSettings } from "@/modules/chat/runtime-settings";

const SYSTEM_PROMPT =
  "You are Atlas, a helpful assistant. Answer clearly and accurately. You do not have access to the user's documents in local model-only mode; do not imply that you searched or cited them.";

type GenerationResult = {
  answer: string;
  inputTokens: number;
  outputTokens: number;
};

function ollamaBaseUrl(): string {
  const value = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OLLAMA_BASE_URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("OLLAMA_BASE_URL must not include credentials.");
  }
  return url.toString().replace(/\/$/, "");
}

export async function listOllamaModels(): Promise<ModelOption[]> {
  const response = await fetch(`${ollamaBaseUrl()}/api/tags`, {
    cache: "no-store",
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Ollama model listing failed (HTTP ${response.status}).`);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.models)) {
    throw new Error("Ollama returned an invalid model list.");
  }
  return payload.models.flatMap((item): ModelOption[] => {
    if (!isRecord(item) || typeof item.name !== "string" || !item.name.trim()) return [];
    return [{
      id: item.name,
      name: item.name,
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
    }];
  });
}

export async function listLocalProviderModels(): Promise<ProviderModels[]> {
  let ollamaModels: ModelOption[] = [];
  let ollamaMessage: string | undefined;
  try {
    ollamaModels = await listOllamaModels();
  } catch {
    console.warn("Ollama model discovery is unavailable.");
    ollamaMessage = "Ollama could not be reached. Check OLLAMA_BASE_URL and start the local service.";
  }

  return [
    {
      id: "openai",
      name: PROVIDER_NAMES.openai,
      configured: Boolean(process.env.OPENAI_API_KEY),
      models: MODEL_CATALOGUE.openai,
      ...(!process.env.OPENAI_API_KEY && { message: "Set OPENAI_API_KEY in .env.local to use OpenAI." }),
    },
    {
      id: "anthropic",
      name: PROVIDER_NAMES.anthropic,
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
      models: MODEL_CATALOGUE.anthropic,
      ...(!process.env.ANTHROPIC_API_KEY && { message: "Set ANTHROPIC_API_KEY in .env.local to use Anthropic." }),
    },
    {
      id: "google",
      name: PROVIDER_NAMES.google,
      configured: Boolean(process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY),
      models: MODEL_CATALOGUE.google,
      ...(!(process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY) && {
        message: "Set GOOGLE_API_KEY or GEMINI_API_KEY in .env.local to use Gemini.",
      }),
    },
    {
      id: "ollama",
      name: PROVIDER_NAMES.ollama,
      configured: ollamaModels.length > 0,
      models: ollamaModels,
      ...(!ollamaModels.length && { message: ollamaMessage ?? "No local Ollama models are installed." }),
    },
  ];
}

function readUsageCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function withTimeout(signal: AbortSignal, milliseconds: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(milliseconds)]);
}

function isTextBlock(value: unknown): value is { text: string } {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

async function generateOpenAI(
  model: string,
  message: string,
  history: ChatHistoryTurn[],
  signal: AbortSignal,
  settings?: ChatRuntimeSettings,
): Promise<GenerationResult> {
  const runtimeSettings = settings;
  const response = await getOpenAI().responses.create({
    model,
    instructions: SYSTEM_PROMPT,
    temperature: runtimeSettings?.temperature ?? 0.2,
    input: [
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user", content: message },
    ],
    max_output_tokens: runtimeSettings?.maxTokens ?? 2048,
  }, { signal: withTimeout(signal, 60_000) });
  return {
    answer: response.output_text,
    inputTokens: readUsageCount(response.usage?.input_tokens),
    outputTokens: readUsageCount(response.usage?.output_tokens),
  };
}

async function generateAnthropic(
  model: string,
  message: string,
  history: ChatHistoryTurn[],
  signal: AbortSignal,
  settings?: ChatRuntimeSettings,
): Promise<GenerationResult> {
  const providerKey = process.env.ANTHROPIC_API_KEY;
  if (!providerKey) throw new Error("Set ANTHROPIC_API_KEY in .env.local to use Anthropic.");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": providerKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      system: SYSTEM_PROMPT,
      max_tokens: settings?.maxTokens ?? 2048,
      temperature: settings?.temperature ?? 0.2,
      messages: [
        ...history.map((turn) => ({ role: turn.role === "assistant" ? "assistant" : "user", content: turn.content })),
        { role: "user", content: message },
      ],
    }),
    signal: withTimeout(signal, 60_000),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`Anthropic request failed (HTTP ${response.status}).`);
  if (!isRecord(payload) || !Array.isArray(payload.content)) {
    throw new Error("Anthropic returned an invalid response.");
  }
  const answer = payload.content
    .filter(isTextBlock)
    .map((item) => item.text)
    .join("");
  const usage = isRecord(payload.usage) ? payload.usage : {};
  return {
    answer,
    inputTokens: readUsageCount(usage.input_tokens),
    outputTokens: readUsageCount(usage.output_tokens),
  };
}

async function generateGoogle(
  model: string,
  message: string,
  history: ChatHistoryTurn[],
  signal: AbortSignal,
  settings?: ChatRuntimeSettings,
): Promise<GenerationResult> {
  const providerKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!providerKey) throw new Error("Set GOOGLE_API_KEY or GEMINI_API_KEY in .env.local to use Gemini.");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": providerKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          ...history.map((turn) => ({
            role: turn.role === "assistant" ? "model" : "user",
            parts: [{ text: turn.content }],
          })),
          { role: "user", parts: [{ text: message }] },
        ],
        generationConfig: {
          maxOutputTokens: settings?.maxTokens ?? 2048,
          temperature: settings?.temperature ?? 0.2,
        },
      }),
      signal: withTimeout(signal, 60_000),
    },
  );
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`Gemini request failed (HTTP ${response.status}).`);
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
    throw new Error("Gemini returned an invalid response.");
  }
  const candidate = payload.candidates[0];
  const content = isRecord(candidate) && isRecord(candidate.content) ? candidate.content : {};
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const answer = parts
    .filter((part): part is { text: string } => isRecord(part) && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  const usage = isRecord(payload.usageMetadata) ? payload.usageMetadata : {};
  return {
    answer,
    inputTokens: readUsageCount(usage.promptTokenCount),
    outputTokens: readUsageCount(usage.candidatesTokenCount),
  };
}

async function generateOllama(
  model: string,
  message: string,
  history: ChatHistoryTurn[],
  signal: AbortSignal,
  settings?: ChatRuntimeSettings,
): Promise<GenerationResult> {
  const response = await fetch(`${ollamaBaseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      options: {
        num_predict: settings?.maxTokens ?? 2048,
        temperature: settings?.temperature ?? 0.2,
      },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
        { role: "user", content: message },
      ],
    }),
    signal: withTimeout(signal, 120_000),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`Ollama request failed (HTTP ${response.status}).`);
  if (!isRecord(payload) || !isRecord(payload.message) || typeof payload.message.content !== "string") {
    throw new Error("Ollama returned an invalid response.");
  }
  return {
    answer: payload.message.content,
    inputTokens: readUsageCount(payload.prompt_eval_count),
    outputTokens: readUsageCount(payload.eval_count),
  };
}

export async function generateLocalModelAnswer(
  provider: ModelProvider,
  model: string,
  message: string,
  history: ChatHistoryTurn[],
  signal: AbortSignal,
  settings?: ChatRuntimeSettings,
): Promise<GenerationResult> {
  switch (provider) {
    case "openai":
      return generateOpenAI(model, message, history, signal, settings);
    case "anthropic":
      return generateAnthropic(model, message, history, signal, settings);
    case "google":
      return generateGoogle(model, message, history, signal, settings);
    case "ollama":
      return generateOllama(model, message, history, signal, settings);
  }
}
