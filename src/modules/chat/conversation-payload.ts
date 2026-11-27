import { parseConversationList } from "@/modules/chat/conversation-validation";
import type { Conversation } from "@/modules/chat/types";
import { isRecord } from "@/modules/shared/lib/guards";
import { parseFailed, parseOk, type ParseResult } from "@/modules/shared/lib/parse";

export const INVALID_CONVERSATION_LIST_MESSAGE = "Provide a valid conversation list.";
export const INVALID_CONVERSATION_DATA_MESSAGE = "The conversation list contains invalid data.";
export const INVALID_CONVERSATION_UPDATE_MESSAGE = "Provide a valid conversation update.";
export const CONVERSATION_OWNER_MISMATCH_MESSAGE =
  "The conversation owner does not match the signed-in account.";

/**
 * Validates a conversation save payload against the authenticated account.
 * Owner spoofing is a 403; malformed payloads are 400.
 */
export function parseConversationSavePayload(
  value: unknown,
  accountId: string,
): ParseResult<Conversation[]> {
  if (!isRecord(value) || typeof value.ownerId !== "string" || !("conversations" in value)) {
    return parseFailed(INVALID_CONVERSATION_LIST_MESSAGE, 400);
  }
  if (value.ownerId !== accountId) {
    return parseFailed(CONVERSATION_OWNER_MISMATCH_MESSAGE, 403);
  }
  const conversations = parseConversationList(value.conversations);
  if (!conversations) {
    return parseFailed(INVALID_CONVERSATION_DATA_MESSAGE, 400);
  }
  return parseOk(conversations);
}

export type ConversationUpdate = {
  conversation: Conversation;
  messages: Array<{ message: Conversation["messages"][number]; sequence: number }>;
};

export function parseConversationUpdatePayload(
  value: unknown,
  accountId: string,
): ParseResult<ConversationUpdate> {
  if (
    !isRecord(value) ||
    typeof value.ownerId !== "string" ||
    !("conversation" in value) ||
    !Array.isArray(value.messages)
  ) {
    return parseFailed(INVALID_CONVERSATION_UPDATE_MESSAGE, 400);
  }
  if (value.ownerId !== accountId) {
    return parseFailed(CONVERSATION_OWNER_MISMATCH_MESSAGE, 403);
  }
  if (!isRecord(value.conversation)) {
    return parseFailed(INVALID_CONVERSATION_DATA_MESSAGE, 400);
  }

  const writes = value.messages.map((entry) => {
    if (!isRecord(entry) || !Number.isSafeInteger(entry.sequence) || (entry.sequence as number) < 0) {
      return null;
    }
    return { message: entry.message, sequence: entry.sequence as number };
  });
  if (writes.some((write) => write === null)) {
    return parseFailed(INVALID_CONVERSATION_DATA_MESSAGE, 400);
  }

  const metadata = value.conversation;
  const candidate = {
    id: metadata.id,
    title: metadata.title,
    updatedAt: metadata.updatedAt,
    ...(metadata.archivedAt !== undefined ? { archivedAt: metadata.archivedAt } : {}),
    messages: writes.map((write) => write!.message),
  };
  const [conversation] = parseConversationList([candidate]) ?? [];
  if (!conversation) {
    return parseFailed(INVALID_CONVERSATION_DATA_MESSAGE, 400);
  }

  return parseOk({
    conversation: { ...conversation, messages: [] },
    messages: writes.map((write, index) => ({
      message: conversation.messages[index]!,
      sequence: write!.sequence,
    })),
  });
}
