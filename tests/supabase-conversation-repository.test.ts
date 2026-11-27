import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseConversationRepository } from "@/modules/chat/supabase-conversation-repository";
import type { Database } from "@/modules/shared/integrations/database.types";

type Row = Record<string, unknown>;
type RowSet = {
  conversations: Row[];
  messages: Row[];
};

/**
 * Stateful PostgREST fake: filters actually narrow rows, `.order()` stays
 * chainable (the repository orders messages by three columns), and the builder
 * is thenable so `await` resolves with the filtered result.
 */
function fakeClient(rows: RowSet) {
  const rpc = vi.fn(async (_name: string, _args: unknown) => ({
    data: 0 as unknown,
    error: null as unknown,
  }));
  const filters = vi.fn();

  function builder(table: "conversations" | "messages") {
    let selected = [...(table === "conversations" ? rows.conversations : rows.messages)];
    const orders: { column: string; ascending: boolean }[] = [];

    const state = {
      delete: () => state,
      select: (_columns?: string) => state,
      eq: (column: string, value: unknown) => {
        filters(column, value);
        selected = selected.filter((row) => row[column] === value);
        return state;
      },
      in: (column: string, values: unknown[]) => {
        selected = selected.filter((row) => values.includes(row[column]));
        return state;
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        orders.push({ column, ascending: options?.ascending !== false });
        return state;
      },
      then: (
        resolve: (value: { data: Row[]; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => {
        for (const { column, ascending } of [...orders].reverse()) {
          selected = [...selected].sort((a, b) => {
            const left = Number(a[column]);
            const right = Number(b[column]);
            const comparison = Number.isNaN(left) || Number.isNaN(right) ? 0 : left - right;
            return ascending ? comparison : -comparison;
          });
        }
        return Promise.resolve({ data: selected, error: null }).then(resolve, reject);
      },
    };
    return state;
  }

  const client = { from: builder, rpc };
  return { client: client as unknown as SupabaseClient<Database>, rpc, filters };
}

const conversationRow = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  owner_id: "account-1",
  title: "Notes",
  archived_at_ms: null,
  updated_at_ms: 1000,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000011",
    conversation_id: conversationRow.id,
    owner_id: "account-1",
    role: "assistant",
    content: "Answer",
    status: "done",
    stage: "done",
    citations: [
      { id: 1, doc: "doc.pdf", page: 2, section: "Intro", excerpt: "Text", score: 0.8 },
    ],
    tokens: 42,
    sequence: 0,
    created_at_ms: 1001,
    created_at: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

describe("Supabase conversation repository", () => {
  it("lists conversation metadata without fetching every message", async () => {
    const { client } = fakeClient({
      conversations: [conversationRow],
      messages: [
        messageRow({ sequence: 1, content: "Follow-up", citations: null, tokens: null, stage: null, created_at_ms: 1002 }),
        messageRow({ sequence: 0 }),
      ],
    });
    const repository = createSupabaseConversationRepository(client);

    await expect(repository.list("account-1")).resolves.toEqual([
      {
        id: conversationRow.id,
        title: "Notes",
        updatedAt: 1000,
        messages: [],
      },
    ]);

    await expect(repository.listMessages("account-1", conversationRow.id)).resolves.toEqual([
      {
        id: "aaaaaaaa-0000-4000-8000-000000000011",
        role: "assistant",
        content: "Answer",
        status: "done",
        stage: "done",
        citations: [
          { id: 1, doc: "doc.pdf", page: 2, section: "Intro", excerpt: "Text", score: 0.8 },
        ],
        tokens: 42,
        createdAt: 1001,
      },
      {
        id: "aaaaaaaa-0000-4000-8000-000000000011",
        role: "assistant",
        content: "Follow-up",
        status: "done",
        createdAt: 1002,
      },
    ]);
  });

  it("scopes message reads by conversation and skips invalid stored rows", async () => {
    const otherMessage = messageRow({
      id: "aaaaaaaa-0000-4000-8000-000000000012",
      conversation_id: "aaaaaaaa-0000-4000-8000-000000000002",
    });
    const { client } = fakeClient({
      conversations: [conversationRow],
      messages: [otherMessage],
    });
    const repository = createSupabaseConversationRepository(client);

    await expect(repository.listMessages("account-1", conversationRow.id)).resolves.toEqual([]);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const invalidRow = {
      ...conversationRow,
      id: "aaaaaaaa-0000-4000-8000-000000000009",
      title: "",
    };
    const mixed = fakeClient({
      conversations: [conversationRow, invalidRow],
      messages: [messageRow()],
    });
    await expect(
      createSupabaseConversationRepository(mixed.client).list("account-1"),
    ).resolves.toEqual([
      {
        id: conversationRow.id,
        title: "Notes",
        updatedAt: 1000,
        messages: [],
      },
    ]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(invalidRow.id),
    );
    log.mockRestore();
  });

  it("upserts only supplied messages through the owner-checked RPC", async () => {
    const { client, rpc } = fakeClient({ conversations: [], messages: [] });
    const repository = createSupabaseConversationRepository(client);
    const conversation = { id: conversationRow.id, title: "Notes", messages: [], updatedAt: 1000 };
    const message = {
      id: "aaaaaaaa-0000-4000-8000-000000000011",
      role: "user" as const,
      content: "Question",
      status: "done" as const,
      createdAt: 1001,
    };

    await repository.upsert("account-1", {
      conversation,
      messages: [{ message, sequence: 0 }],
    });

    expect(rpc).toHaveBeenCalledWith("upsert_conversation_messages", {
      p_owner_id: "account-1",
      p_conversation: {
        id: conversation.id,
        title: conversation.title,
        archivedAt: null,
        updatedAt: conversation.updatedAt,
      },
      p_messages: [{ ...message, sequence: 0 }],
    });
  });

  it("surfaces RPC errors", async () => {
    const { client, rpc } = fakeClient({ conversations: [], messages: [] });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "denied", name: "PostgrestError", code: "42501", details: "", hint: "" },
    });
    const repository = createSupabaseConversationRepository(client);

    await expect(
      repository.upsert("account-1", {
        conversation: { id: conversationRow.id, title: "Notes", messages: [], updatedAt: 1000 },
        messages: [],
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("deletes by conversation and owner ID", async () => {
    const { client, filters } = fakeClient({ conversations: [], messages: [] });
    const repository = createSupabaseConversationRepository(client);

    await repository.delete("account-1", conversationRow.id);

    expect(filters).toHaveBeenCalledWith("owner_id", "account-1");
    expect(filters).toHaveBeenCalledWith("id", conversationRow.id);
  });
});
