import "server-only";

import type { Conversation } from "@/modules/chat/types";
import { isConversation } from "@/modules/chat/conversation-validation";
import { isRecord } from "@/modules/shared/lib/guards";
import { createJsonStore } from "@/modules/shared/lib/json-store";

type StoredConversation = {
  ownerId: string;
  conversation: Conversation;
};

type ConversationStore = {
  version: 1;
  conversations: StoredConversation[];
};

function isStoredConversation(value: unknown): value is StoredConversation {
  return (
    isRecord(value) &&
    typeof value.ownerId === "string" &&
    isConversation(value.conversation)
  );
}

function isConversationStore(value: unknown): value is ConversationStore {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.conversations) &&
    value.conversations.every(isStoredConversation)
  );
}

const conversationStore = createJsonStore<ConversationStore>({
  fileName: "conversation-store.json",
  createEmpty: () => ({ version: 1, conversations: [] }),
  validate: isConversationStore,
  invalidJsonMessage: "The local conversation store is not valid JSON.",
  unsupportedFormatMessage: "The local conversation store has an unsupported format.",
});

export async function listLocalConversations(ownerId: string): Promise<Conversation[]> {
  const store = await conversationStore.read();
  return store.conversations
    .filter((entry) => entry.ownerId === ownerId)
    .map((entry) => entry.conversation)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function upsertLocalConversation(
  ownerId: string,
  update: {
    conversation: Conversation;
    messages: Array<{ message: Conversation["messages"][number]; sequence: number }>;
  },
): Promise<void> {
  await conversationStore.mutate((store) => {
    const existing = store.conversations.find(
      (entry) => entry.ownerId === ownerId && entry.conversation.id === update.conversation.id,
    )?.conversation;
    const messages = [...(existing?.messages ?? [])];
    for (const { message, sequence } of update.messages) {
      const currentIndex = messages.findIndex((current) => current.id === message.id);
      if (currentIndex >= 0) {
        messages[currentIndex] = message;
      } else {
        messages.splice(Math.min(sequence, messages.length), 0, message);
      }
    }
    const conversation = {
      ...update.conversation,
      messages,
    };
    store.conversations = [
      ...store.conversations.filter(
        (entry) => entry.ownerId !== ownerId || entry.conversation.id !== conversation.id,
      ),
      { ownerId, conversation },
    ];
    return { result: undefined, changed: true };
  });
}

export async function deleteLocalConversation(
  ownerId: string,
  conversationId: string,
): Promise<void> {
  await conversationStore.mutate((store) => {
    const next = store.conversations.filter(
      (entry) => entry.ownerId !== ownerId || entry.conversation.id !== conversationId,
    );
    const changed = next.length !== store.conversations.length;
    if (changed) store.conversations = next;
    return {
      result: undefined,
      changed,
    };
  });
}

export async function deleteAllLocalConversations(ownerId: string): Promise<void> {
  await conversationStore.mutate((store) => {
    const next = store.conversations.filter((entry) => entry.ownerId !== ownerId);
    const changed = next.length !== store.conversations.length;
    if (changed) store.conversations = next;
    return { result: undefined, changed };
  });
}
