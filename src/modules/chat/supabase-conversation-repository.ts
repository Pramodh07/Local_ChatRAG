import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationRepository } from "@/modules/chat/conversation-service";
import type { ConversationUpdate } from "@/modules/chat/conversation-payload";
import { isConversation } from "@/modules/chat/conversation-validation";
import type { Conversation, Message } from "@/modules/chat/types";
import type { Database } from "@/modules/shared/integrations/database.types";
import { logStructured } from "@/modules/shared/lib/logger";

type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];
type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    role: row.role as Message["role"],
    content: row.content,
    status: row.status as Message["status"],
    ...(row.stage ? { stage: row.stage as NonNullable<Message["stage"]> } : {}),
    ...(row.citations !== null ? { citations: row.citations as Message["citations"] } : {}),
    ...(row.tokens !== null ? { tokens: row.tokens } : {}),
    createdAt: row.created_at_ms,
  };
}

function toConversation(row: ConversationRow, messages: MessageRow[]): Conversation | null {
  const conversation: Conversation = {
    id: row.id,
    title: row.title,
    // Sequence is no longer unique (migration 0009); order by stable keys only.
    messages: [...messages]
      .sort((left, right) =>
        left.created_at_ms - right.created_at_ms || left.id.localeCompare(right.id),
      )
      .map(toMessage),
    updatedAt: row.updated_at_ms,
    ...(row.archived_at_ms !== null ? { archivedAt: row.archived_at_ms } : {}),
  };

  if (!isConversation(conversation)) {
    // One corrupt row must not hide the rest of the user's history.
    logStructured("warn", "conversation.row_skipped", { conversationId: row.id });
    return null;
  }
  return conversation;
}

/**
 * Supabase-backed conversation history. Reads and writes use owner-scoped RLS;
 * each write contains only changed messages, so tabs can add messages without
 * replacing another tab's transcript.
 */
export function createSupabaseConversationRepository(
  supabase: SupabaseClient<Database>,
): ConversationRepository {
  return {
    async list(accountId) {
      const { data: conversationRows, error: conversationError } = await supabase
        .from("conversations")
        .select("id, owner_id, title, archived_at_ms, updated_at_ms, created_at, updated_at")
        .eq("owner_id", accountId)
        .order("updated_at_ms", { ascending: false });
      if (conversationError) throw conversationError;
      // Metadata only. Messages are fetched per conversation by listMessages so
      // a large history can never be silently truncated by PostgREST's row cap.
      return (conversationRows ?? []).flatMap((row) => {
        const conversation = toConversation(row, []);
        return conversation ? [conversation] : [];
      });
    },

    async listMessages(accountId, conversationId) {
      // Bounded to one conversation's transcript, ordered with an explicit tie
      // breaker (migration 0009 removed sequence uniqueness).
      const { data, error } = await supabase
        .from("messages")
        .select(
          "id, conversation_id, owner_id, role, content, status, stage, citations, tokens, sequence, created_at_ms, created_at",
        )
        .eq("owner_id", accountId)
        .eq("conversation_id", conversationId)
        .order("created_at_ms", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return [...(data ?? [])].map(toMessage);
    },

    async upsert(accountId, update: ConversationUpdate) {
      const { error } = await supabase.rpc("upsert_conversation_messages", {
        p_owner_id: accountId,
        p_conversation: {
          id: update.conversation.id,
          title: update.conversation.title,
          archivedAt: update.conversation.archivedAt ?? null,
          updatedAt: update.conversation.updatedAt,
        },
        p_messages: update.messages.map(({ message, sequence }) => ({
          ...message,
          sequence,
        })),
      });
      if (error) throw error;
    },

    async delete(accountId, conversationId) {
      const { error } = await supabase
        .from("conversations")
        .delete()
        .eq("owner_id", accountId)
        .eq("id", conversationId);
      if (error) throw error;
    },

    async deleteAll(accountId) {
      const { error } = await supabase
        .from("conversations")
        .delete()
        .eq("owner_id", accountId);
      if (error) throw error;
    },
  };
}
