import type { Conversation } from "@/modules/chat/types";
import {
  deleteAllLocalConversations,
  deleteLocalConversation,
  listLocalConversations,
  upsertLocalConversation,
} from "@/modules/chat/local-conversation-store";
import {
  parseConversationUpdatePayload,
  type ConversationUpdate,
} from "@/modules/chat/conversation-payload";
import { ForbiddenError, ValidationError } from "@/modules/shared/lib/errors";

export type ConversationRepository = {
  list(accountId: string): Promise<Conversation[]>;
  /** Load messages for one conversation only, bounded by PostgREST's row cap. */
  listMessages(accountId: string, conversationId: string): Promise<Conversation["messages"]>;
  upsert(accountId: string, update: ConversationUpdate): Promise<void>;
  delete(accountId: string, conversationId: string): Promise<void>;
  deleteAll(accountId: string): Promise<void>;
};

export const localConversationRepository: ConversationRepository = {
  list: listLocalConversations,
  async listMessages(accountId, conversationId) {
    const conversations = await listLocalConversations(accountId);
    return conversations.find((conversation) => conversation.id === conversationId)?.messages ?? [];
  },
  upsert: upsertLocalConversation,
  delete: deleteLocalConversation,
  deleteAll: deleteAllLocalConversations,
};

export async function loadConversations(
  repository: ConversationRepository,
  accountId: string,
): Promise<Conversation[]> {
  return repository.list(accountId);
}

export async function saveConversationUpdate(
  repository: ConversationRepository,
  accountId: string,
  payload: unknown,
): Promise<number> {
  const parsed = parseConversationUpdatePayload(payload, accountId);
  if (!parsed.ok) {
    if (parsed.status === 403) throw new ForbiddenError(parsed.message);
    throw new ValidationError(parsed.message);
  }

  await repository.upsert(accountId, parsed.value);
  return parsed.value.messages.length;
}
