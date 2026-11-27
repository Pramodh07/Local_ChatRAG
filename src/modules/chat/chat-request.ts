import type { ChatHistoryTurn } from "@/modules/chat/types";
import { isChatRuntimeSettings, type ChatRuntimeSettings } from "@/modules/chat/runtime-settings";
import { isModelProvider, type ModelProvider } from "@/modules/account/types";
import { isRecord } from "@/modules/shared/lib/guards";
import { readJsonBody } from "@/modules/shared/lib/request";
import { parseFailed, parseOk, type ParseResult } from "@/modules/shared/lib/parse";

export const MAX_CHAT_REQUEST_BYTES = 64 * 1024;
export const MAX_CHAT_MESSAGE_LENGTH = 4_000;
export const MAX_CHAT_HISTORY_TURNS = 8;
export const CHAT_VALIDATION_MESSAGE =
  "Provide a message of 1–4,000 characters and at most 8 valid history turns.";

export type ChatRequest = {
  message: string;
  history: ChatHistoryTurn[];
  settings?: ChatRuntimeSettings;
  /** Optional server-side model selection; omitted means use the account/default model. */
  provider?: ModelProvider;
  model?: string;
};

/** Basic validation only; model availability is checked where the model is resolved. */
function isRequestModel(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const model = value.trim();
  if (!model || model.length > 200) return false;
  for (const character of model) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

/** Pure request validation. Kept separate from I/O so it is directly testable. */
export function parseChatRequest(value: unknown): ChatRequest | null {
  if (!isRecord(value) || typeof value.message !== "string") return null;
  const message = value.message.trim();
  if (!message || message.length > MAX_CHAT_MESSAGE_LENGTH) return null;

  const historyValue = value.history ?? [];
  if (!Array.isArray(historyValue) || historyValue.length > MAX_CHAT_HISTORY_TURNS) return null;

  const history: ChatHistoryTurn[] = [];
  for (const turn of historyValue) {
    if (
      !isRecord(turn) ||
      (turn.role !== "user" && turn.role !== "assistant") ||
      typeof turn.content !== "string" ||
      turn.content.length > MAX_CHAT_MESSAGE_LENGTH
    ) {
      return null;
    }
    history.push({ role: turn.role, content: turn.content });
  }
  if (value.settings !== undefined && !isChatRuntimeSettings(value.settings)) return null;
  if (value.provider !== undefined && !isModelProvider(value.provider)) return null;
  if (value.model !== undefined && !isRequestModel(value.model)) return null;
  return {
    message,
    history,
    ...(value.settings !== undefined && { settings: value.settings }),
    ...(value.provider !== undefined && { provider: value.provider }),
    ...(value.model !== undefined && { model: value.model.trim() }),
  };
}

export async function readChatRequest(request: Request): Promise<ParseResult<ChatRequest>> {
  const body = await readJsonBody(request, {
    maxBytes: MAX_CHAT_REQUEST_BYTES,
    tooLargeMessage: "Chat request is too large.",
  });
  if (!body.ok) return parseFailed(body.error, body.status);

  const parsed = parseChatRequest(body.data);
  if (!parsed) return parseFailed(CHAT_VALIDATION_MESSAGE, 400);
  return parseOk(parsed);
}
