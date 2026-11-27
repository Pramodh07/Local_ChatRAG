import "server-only";

import { getOpenAI } from "@/modules/shared/integrations/openai";
import type { ChatHistoryTurn } from "@/modules/chat/types";
import type { ChatRuntimeSettings } from "@/modules/chat/runtime-settings";
import type { ModelProvider } from "@/modules/account/types";
import { ServiceConfigurationError, UpstreamError } from "@/modules/shared/lib/errors";
import { isRecord } from "@/modules/shared/lib/guards";

/**
 * Coarse token estimate used when a provider does not report streaming usage.
 * Provider-reported usage always takes precedence in `stats`.
 */
export function estimateStreamTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export type StreamStats = {
  inputTokens: number;
  outputTokens: number;
};

export type StreamLocalModelInput = {
  provider: ModelProvider;
  model: string;
  message: string;
  history: ChatHistoryTurn[];
  signal: AbortSignal;
  settings?: ChatRuntimeSettings;
  /** Overrides the local-mode system prompt (used by the RAG path). */
  systemPrompt?: string;
  /** Mutable counters filled while chunks arrive. */
  stats?: StreamStats;
};

const DEFAULT_SYSTEM_PROMPT =
  "You are Atlas, a helpful assistant. Answer clearly and accurately. You do not have access to the user's documents in local model-only mode; do not imply that you searched or cited them.";

function withTimeout(signal: AbortSignal, milliseconds: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(milliseconds)]);
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function requireEnvKey(value: string | undefined, message: string): string {
  const key = value?.trim();
  if (!key) throw new ServiceConfigurationError(message);
  return key;
}

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

/** Splits a byte stream into newline-delimited text lines. */
async function* streamLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        yield line;
        newline = buffer.indexOf("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
  const tail = buffer.replace(/\r$/, "");
  if (tail) yield tail;
}

/** Extracts SSE `data:` payloads; blank lines delimit events. */
async function* streamSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  let dataLines: string[] = [];
  for await (const line of streamLines(body)) {
    if (!line.trim()) {
      if (dataLines.length) {
        yield dataLines.join("\n");
        dataLines = [];
      }
      continue;
    }
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
  }
  if (dataLines.length) yield dataLines.join("\n");
}

function parseJsonLine(payload: string, providerLabel: string): unknown {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new UpstreamError(`${providerLabel} returned an invalid stream event.`);
  }
}

async function* streamOpenAI(
  input: StreamLocalModelInput,
  stats: StreamStats,
): AsyncGenerator<string> {
  const { model, message, history, signal, settings, systemPrompt } = input;
  const stream = await getOpenAI().chat.completions.create(
    {
      model,
      stream: true,
      stream_options: { include_usage: true },
      temperature: settings?.temperature ?? 0.2,
      max_completion_tokens: settings?.maxTokens ?? 2048,
      messages: [
        { role: "system", content: systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
        ...history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: "user", content: message },
      ],
    },
    { signal: withTimeout(signal, 60_000) },
  );

  for await (const chunk of stream) {
    if (signal.aborted) return;
    const usage = chunk.usage;
    if (usage) {
      stats.inputTokens = readCount(usage.prompt_tokens) || stats.inputTokens;
      stats.outputTokens = readCount(usage.completion_tokens) || stats.outputTokens;
    }
    const text = chunk.choices[0]?.delta?.content;
    if (text) {
      stats.outputTokens += estimateStreamTokens(text);
      yield text;
    }
  }
}

async function* streamAnthropic(
  input: StreamLocalModelInput,
  stats: StreamStats,
): AsyncGenerator<string> {
  const apiKey = requireEnvKey(
    process.env.ANTHROPIC_API_KEY,
    "Set ANTHROPIC_API_KEY in .env.local to use Anthropic.",
  );
  const { model, message, history, signal, settings, systemPrompt } = input;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      stream: true,
      system: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      max_tokens: settings?.maxTokens ?? 2048,
      temperature: settings?.temperature ?? 0.2,
      messages: [
        ...history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: "user", content: message },
      ],
    }),
    signal: withTimeout(signal, 60_000),
  });
  if (!response.ok) throw new UpstreamError(`Anthropic request failed (HTTP ${response.status}).`);
  if (!response.body) throw new UpstreamError("Anthropic returned an empty stream.");

  for await (const data of streamSseData(response.body)) {
    if (signal.aborted) return;
    if (data === "[DONE]") break;
    const event = parseJsonLine(data, "Anthropic");
    if (!isRecord(event)) continue;
    if (event.type === "error") {
      const error = isRecord(event.error) && typeof event.error.message === "string"
        ? event.error.message
        : "Anthropic stream failed.";
      throw new UpstreamError(error);
    }
    if (event.type === "message_start") {
      const messageStart = isRecord(event.message) ? event.message : {};
      stats.inputTokens = readCount(isRecord(messageStart.usage) ? messageStart.usage.input_tokens : undefined);
    }
    if (event.type === "message_delta") {
      const usage = isRecord(event.usage) ? event.usage : {};
      stats.outputTokens = readCount(usage.output_tokens) || stats.outputTokens;
    }
    if (event.type === "content_block_delta") {
      const delta = isRecord(event.delta) ? event.delta : {};
      if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
        stats.outputTokens += estimateStreamTokens(delta.text);
        yield delta.text;
      }
    }
  }
}

async function* streamGoogle(
  input: StreamLocalModelInput,
  stats: StreamStats,
): AsyncGenerator<string> {
  const apiKey = requireEnvKey(
    process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY,
    "Set GOOGLE_API_KEY or GEMINI_API_KEY in .env.local to use Gemini.",
  );
  const { model, message, history, signal, settings, systemPrompt } = input;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt ?? DEFAULT_SYSTEM_PROMPT }] },
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
  if (!response.ok) throw new UpstreamError(`Gemini request failed (HTTP ${response.status}).`);
  if (!response.body) throw new UpstreamError("Gemini returned an empty stream.");

  for await (const data of streamSseData(response.body)) {
    if (signal.aborted) return;
    if (data === "[DONE]") break;
    const parsed = parseJsonLine(data, "Gemini");
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!isRecord(item)) continue;
      const candidates = Array.isArray(item.candidates) ? item.candidates : [];
      const candidate = candidates[0];
      const content = isRecord(candidate) && isRecord(candidate.content) ? candidate.content : {};
      const parts = Array.isArray(content.parts) ? content.parts : [];
      for (const part of parts) {
        if (isRecord(part) && typeof part.text === "string" && part.text) {
          stats.outputTokens += estimateStreamTokens(part.text);
          yield part.text;
        }
      }
      const usage = isRecord(item.usageMetadata) ? item.usageMetadata : {};
      stats.inputTokens = readCount(usage.promptTokenCount) || stats.inputTokens;
      stats.outputTokens = readCount(usage.candidatesTokenCount) || stats.outputTokens;
    }
  }
}

async function* streamOllama(
  input: StreamLocalModelInput,
  stats: StreamStats,
): AsyncGenerator<string> {
  const { model, message, history, signal, settings, systemPrompt } = input;
  const response = await fetch(`${ollamaBaseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      options: {
        num_predict: settings?.maxTokens ?? 2048,
        temperature: settings?.temperature ?? 0.2,
      },
      messages: [
        { role: "system", content: systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
        ...history,
        { role: "user", content: message },
      ],
    }),
    signal: withTimeout(signal, 120_000),
  });
  if (!response.ok) throw new UpstreamError(`Ollama request failed (HTTP ${response.status}).`);
  if (!response.body) throw new UpstreamError("Ollama returned an empty stream.");

  for await (const line of streamLines(response.body)) {
    if (signal.aborted) return;
    if (!line.trim()) continue;
    const payload = parseJsonLine(line, "Ollama");
    if (!isRecord(payload)) continue;
    if (typeof payload.error === "string" && payload.error) {
      throw new UpstreamError(`Ollama stream failed: ${payload.error}`);
    }
    const innerMessage = isRecord(payload.message) ? payload.message : {};
    if (typeof innerMessage.content === "string" && innerMessage.content) {
      stats.outputTokens += estimateStreamTokens(innerMessage.content);
      yield innerMessage.content;
    }
    stats.inputTokens = readCount(payload.prompt_eval_count) || stats.inputTokens;
    stats.outputTokens = readCount(payload.eval_count) || stats.outputTokens;
    if (payload.done === true) break;
  }
}

/**
 * Streams answer text from the selected provider using server environment keys
 * only. Browser-supplied keys are never accepted. `stats` is populated as
 * chunks arrive so the caller can report token usage in its final frame.
 */
export async function* streamLocalModelAnswer(
  input: StreamLocalModelInput,
): AsyncGenerator<string> {
  const stats = input.stats ?? { inputTokens: 0, outputTokens: 0 };
  switch (input.provider) {
    case "openai":
      yield* streamOpenAI(input, stats);
      return;
    case "anthropic":
      yield* streamAnthropic(input, stats);
      return;
    case "google":
      yield* streamGoogle(input, stats);
      return;
    case "ollama":
      yield* streamOllama(input, stats);
      return;
  }
}
