import type { Conversation, Message } from "@/modules/chat/types";

export type ConversationUpdate = {
  conversation: Conversation;
  messages: Array<{ message: Message; sequence: number }>;
  snapshot: Conversation;
};

export function sameMessage(left: Message, right: Message): boolean {
  if (left === right) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Collects the minimal set of message writes for the current conversation state.
 *
 * Uses an id-to-index map per conversation, so a save is O(messages) instead of
 * scanning the previous transcript once per message. The emitted shape matches
 * the server's incremental upsert contract: only changed messages, with their
 * position in the current transcript.
 */
export function collectConversationUpdates(
  conversations: Conversation[],
  persisted: Map<string, Conversation>,
): ConversationUpdate[] {
  const updates: ConversationUpdate[] = [];

  for (const conversation of conversations) {
    const previous = persisted.get(conversation.id);
    const previousIndexes = new Map<string, number>();
    previous?.messages.forEach((message, index) => {
      if (!previousIndexes.has(message.id)) previousIndexes.set(message.id, index);
    });

    const messages: ConversationUpdate["messages"] = [];
    conversation.messages.forEach((message, sequence) => {
      const previousSequence = previousIndexes.get(message.id) ?? -1;
      const previousMessage =
        previousSequence >= 0 ? previous?.messages[previousSequence] : undefined;
      if (
        previousMessage &&
        previousSequence === sequence &&
        sameMessage(previousMessage, message)
      ) {
        return;
      }
      messages.push({ message, sequence });
    });

    const metadataChanged =
      !previous ||
      previous.title !== conversation.title ||
      previous.updatedAt !== conversation.updatedAt ||
      previous.archivedAt !== conversation.archivedAt;
    if (!metadataChanged && messages.length === 0) continue;

    updates.push({ conversation, messages, snapshot: conversation });
  }

  return updates;
}
