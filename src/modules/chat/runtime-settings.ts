import { isRecord } from "@/modules/shared/lib/guards";
import { ValidationError } from "@/modules/shared/lib/errors";

export type ChatRuntimeSettings = {
  temperature: number;
  maxTokens: number;
  topK: number;
  chunkSize: number;
  similarityThreshold: number;
};

export const DEFAULT_DOCUMENT_CHUNK_SIZE = 1200;

export const DEFAULT_CHAT_RUNTIME_SETTINGS: ChatRuntimeSettings = {
  temperature: 0.2,
  maxTokens: 1200,
  topK: 5,
  chunkSize: DEFAULT_DOCUMENT_CHUNK_SIZE,
  similarityThreshold: 0.25,
};

export function isChatRuntimeSettings(value: unknown): value is ChatRuntimeSettings {
  return (
    isRecord(value) &&
    typeof value.temperature === "number" &&
    Number.isFinite(value.temperature) &&
    value.temperature >= 0 &&
    value.temperature <= 1 &&
    typeof value.maxTokens === "number" &&
    Number.isSafeInteger(value.maxTokens) &&
    value.maxTokens >= 128 &&
    value.maxTokens <= 4096 &&
    typeof value.topK === "number" &&
    Number.isSafeInteger(value.topK) &&
    value.topK >= 1 &&
    value.topK <= 20 &&
    typeof value.chunkSize === "number" &&
    Number.isSafeInteger(value.chunkSize) &&
    value.chunkSize >= 400 &&
    value.chunkSize <= 4000 &&
    typeof value.similarityThreshold === "number" &&
    Number.isFinite(value.similarityThreshold) &&
    value.similarityThreshold >= 0 &&
    value.similarityThreshold <= 1
  );
}

function storageKey(accountId: string): string {
  return `atlas-chat-settings:${encodeURIComponent(accountId)}`;
}

export function getStoredChatRuntimeSettings(accountId: string): ChatRuntimeSettings {
  const stored = window.localStorage.getItem(storageKey(accountId));
  if (stored === null) return { ...DEFAULT_CHAT_RUNTIME_SETTINGS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new Error("Saved chat settings are invalid. Reset them in Settings and try again.");
  }
  if (!isChatRuntimeSettings(parsed)) {
    throw new Error("Saved chat settings are invalid. Reset them in Settings and try again.");
  }
  return parsed;
}

export function storeChatRuntimeSettings(accountId: string, settings: ChatRuntimeSettings): void {
  if (!isChatRuntimeSettings(settings)) {
    throw new Error("Use a temperature from 0 to 1, 128–4096 output tokens, 1–20 results, a 400–4000 character chunk size, and a 0–1 similarity threshold.");
  }
  window.localStorage.setItem(storageKey(accountId), JSON.stringify(settings));
}

export function readDocumentChunkSize(request: Request): number {
  const raw = request.headers.get("x-atlas-chunk-size");
  if (raw === null) return DEFAULT_DOCUMENT_CHUNK_SIZE;
  const chunkSize = Number(raw);
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 400 || chunkSize > 4000) {
    throw new ValidationError("Chunk size must be an integer from 400 to 4000 characters.");
  }
  return chunkSize;
}
