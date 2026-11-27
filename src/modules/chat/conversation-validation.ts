import type { Citation, Conversation, Message } from "@/modules/chat/types";
import { isRecord } from "@/modules/shared/lib/guards";

const MAX_CONVERSATIONS = 500;
const MAX_MESSAGES_PER_CONVERSATION = 2_000;
const MAX_MESSAGE_LENGTH = 100_000;

// Storage casts these ids to `uuid` in SQL; reject malformed values here so a
// bad request returns 400 instead of a Postgres 22P02 cast error (500).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isCitation(value: unknown): value is Citation {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    Number.isFinite(value.id) &&
    typeof value.doc === "string" &&
    (value.page === undefined || (typeof value.page === "number" && Number.isFinite(value.page))) &&
    (value.section === undefined || typeof value.section === "string") &&
    typeof value.excerpt === "string" &&
    typeof value.score === "number" &&
    Number.isFinite(value.score)
  );
}

function isMessage(value: unknown): value is Message {
  return (
    isRecord(value) &&
    isUuid(value.id) &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" &&
    value.content.length <= MAX_MESSAGE_LENGTH &&
    (value.status === "streaming" ||
      value.status === "done" ||
      value.status === "stopped" ||
      value.status === "error") &&
    (value.stage === undefined || value.stage === "retrieving" || value.stage === "done") &&
    (value.citations === undefined ||
      (Array.isArray(value.citations) && value.citations.every(isCitation))) &&
    (value.tokens === undefined ||
      (typeof value.tokens === "number" && Number.isFinite(value.tokens) && value.tokens >= 0)) &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt) &&
    value.createdAt >= 0
  );
}

export function isConversation(value: unknown): value is Conversation {
  return (
    isRecord(value) &&
    isUuid(value.id) &&
    typeof value.title === "string" &&
    value.title.length > 0 &&
    value.title.length <= 200 &&
    Array.isArray(value.messages) &&
    value.messages.length <= MAX_MESSAGES_PER_CONVERSATION &&
    value.messages.every(isMessage) &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt) &&
    value.updatedAt >= 0 &&
    (value.archivedAt === undefined ||
      (typeof value.archivedAt === "number" &&
        Number.isFinite(value.archivedAt) &&
        value.archivedAt >= 0))
  );
}

export function parseConversationList(value: unknown): Conversation[] | null {
  if (!Array.isArray(value) || value.length > MAX_CONVERSATIONS || !value.every(isConversation)) {
    return null;
  }
  const ids = new Set(value.map((conversation) => conversation.id));
  return ids.size === value.length ? value : null;
}
