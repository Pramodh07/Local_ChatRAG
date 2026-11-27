import "server-only";

import type { PGlite } from "@electric-sql/pglite";
import type { ConversationRepository } from "@/modules/chat/conversation-service";
import type { ConversationUpdate } from "@/modules/chat/conversation-payload";
import { isConversation } from "@/modules/chat/conversation-validation";
import type { Conversation, Message } from "@/modules/chat/types";
import { logStructured } from "@/modules/shared/lib/logger";
import { getLocalDatabase } from "@/modules/shared/integrations/pglite-runtime";

type ConversationRow = {
  id: string;
  title: string;
  archived_at_ms: number | null;
  updated_at_ms: number;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  status: string;
  stage: string | null;
  citations: unknown;
  tokens: number | null;
  sequence: number;
  created_at_ms: number;
};

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
 * Local PostgreSQL conversation history.
 *
 * The embedded runtime has no Supabase identity, so writes set the local
 * account ID in the transaction-scoped `auth.uid()` setting. Reads filter by
 * `owner_id` explicitly; PGlite runs as a superuser and bypasses RLS.
 */
export function createPgliteConversationRepository(
  database: () => Promise<PGlite> = getLocalDatabase,
): ConversationRepository {
  return {
    async list(accountId) {
      const db = await database();
      const { rows: conversationRows } = await db.query<ConversationRow>(
        `select
           id,
           title,
           archived_at_ms::double precision as archived_at_ms,
           updated_at_ms::double precision as updated_at_ms
         from public.conversations
         where owner_id = $1
         order by updated_at_ms desc`,
        [accountId],
      );
      if (conversationRows.length === 0) return [];

      const { rows: messageRows } = await db.query<MessageRow>(
        `select
           id,
           conversation_id,
           role,
           content,
           status,
           stage,
           citations,
           tokens::integer as tokens,
           sequence::integer as sequence,
           created_at_ms::double precision as created_at_ms
         from public.messages
         where owner_id = $1
         order by conversation_id, created_at_ms, id`,
        [accountId],
      );

      const messagesByConversation = new Map<string, MessageRow[]>();
      for (const row of messageRows) {
        const bucket = messagesByConversation.get(row.conversation_id);
        if (bucket) bucket.push(row);
        else messagesByConversation.set(row.conversation_id, [row]);
      }

      return conversationRows.flatMap((row) => {
        const conversation = toConversation(row, messagesByConversation.get(row.id) ?? []);
        return conversation ? [conversation] : [];
      });
    },

    async listMessages(accountId, conversationId) {
      const db = await database();
      const { rows } = await db.query<MessageRow>(
        `select
           id, conversation_id, role, content, status, stage, citations,
           tokens::integer as tokens,
           sequence::integer as sequence,
           created_at_ms::double precision as created_at_ms
         from public.messages
         where owner_id = $1 and conversation_id = $2
         order by created_at_ms, id`,
        [accountId, conversationId],
      );
      return rows.map(toMessage);
    },

    async upsert(accountId, update: ConversationUpdate) {
      if (!isConversation({ ...update.conversation, messages: [] }) ||
          update.messages.some(({ message }) => !isConversation({
            id: update.conversation.id,
            title: update.conversation.title,
            updatedAt: update.conversation.updatedAt,
            messages: [message],
          }))) {
        throw new Error("A conversation update has an unsupported format.");
      }

      const db = await database();
      await db.transaction(async (tx) => {
        await tx.query(
          `insert into auth.users (id, email, raw_user_meta_data)
           values ($1, null, '{}'::jsonb)
           on conflict (id) do nothing`,
          [accountId],
        );
        await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [accountId]);
        await tx.query(
          `insert into public.conversations
             (id, owner_id, title, archived_at_ms, updated_at_ms)
           values ($1, $2, $3, $4, $5)
           on conflict (id) do update
             set title = excluded.title,
                 archived_at_ms = excluded.archived_at_ms,
                 updated_at_ms = excluded.updated_at_ms,
                 updated_at = now()
           where conversations.owner_id = excluded.owner_id
             and conversations.updated_at_ms <= excluded.updated_at_ms`,
          [
            update.conversation.id,
            accountId,
            update.conversation.title,
            update.conversation.archivedAt ?? null,
            update.conversation.updatedAt,
          ],
        );
        for (const { message, sequence } of update.messages) {
          await tx.query(
            `insert into public.messages
               (id, conversation_id, owner_id, role, content, status, stage,
                citations, tokens, sequence, created_at_ms)
             values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
             on conflict (id) do update
               set content = excluded.content,
                   status = excluded.status,
                   stage = excluded.stage,
                   citations = excluded.citations,
                   tokens = excluded.tokens,
                   sequence = excluded.sequence
             where messages.owner_id = excluded.owner_id
               and messages.conversation_id = excluded.conversation_id
               and messages.created_at_ms <= excluded.created_at_ms`,
            [
              message.id,
              update.conversation.id,
              accountId,
              message.role,
              message.content,
              message.status,
              message.stage ?? null,
              JSON.stringify(message.citations ?? null),
              message.tokens ?? null,
              sequence,
              message.createdAt,
            ],
          );
        }
      });
    },

    async delete(accountId, conversationId) {
      const db = await database();
      await db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [accountId]);
        await tx.query(
          "delete from public.conversations where id = $1 and owner_id = $2",
          [conversationId, accountId],
        );
      });
    },

    async deleteAll(accountId) {
      const db = await database();
      await db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [accountId]);
        await tx.query(
          "delete from public.conversations where owner_id = $1",
          [accountId],
        );
      });
    },
  };
}
