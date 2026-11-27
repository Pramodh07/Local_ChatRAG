import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPgliteConversationRepository } from "@/modules/chat/pglite-conversation-repository";
import type { Conversation } from "@/modules/chat/types";
import { createTestLocalDatabase } from "./helpers/pglite";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

const aliceOlder: Conversation = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Alice older",
  updatedAt: 1_000,
  messages: [
    {
      id: "aaaaaaaa-0000-4000-8000-000000000011",
      role: "user",
      content: "First question",
      status: "done",
      createdAt: 1_001,
    },
    {
      id: "aaaaaaaa-0000-4000-8000-000000000012",
      role: "assistant",
      content: "First answer",
      status: "done",
      stage: "done",
      citations: [
        {
          id: 1,
          doc: "notes.md",
          page: 2,
          section: "Overview",
          excerpt: "First answer",
          score: 0.9,
        },
      ],
      tokens: 21,
      createdAt: 1_002,
    },
  ],
};

const aliceNewer: Conversation = {
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  title: "Alice newer",
  updatedAt: 3_000,
  archivedAt: 3_100,
  messages: [],
};

const bobConversation: Conversation = {
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  title: "Bob chat",
  updatedAt: 2_000,
  messages: [
    {
      id: "bbbbbbbb-0000-4000-8000-000000000011",
      role: "user",
      content: "Bob question",
      status: "done",
      createdAt: 2_001,
    },
  ],
};

function updateFor(conversation: Conversation) {
  return {
    conversation: { ...conversation, messages: [] },
    messages: conversation.messages.map((message, sequence) => ({ message, sequence })),
  };
}

describe("embedded PostgreSQL conversation repository", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestLocalDatabase();
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it("persists, orders, and isolates owner conversations", async () => {
    const repository = createPgliteConversationRepository(async () => db);

    await repository.upsert(ALICE, updateFor(aliceOlder));
    await repository.upsert(ALICE, updateFor(aliceNewer));
    await repository.upsert(BOB, updateFor(bobConversation));

    const alice = await repository.list(ALICE);
    expect(alice.map((conversation) => conversation.id)).toEqual([
      aliceNewer.id,
      aliceOlder.id,
    ]);
    expect(alice[1]).toEqual(aliceOlder);
    expect(alice[0]).toEqual(aliceNewer);

    const bob = await repository.list(BOB);
    expect(bob).toEqual([bobConversation]);

    const owners = await db.query<{ id: string }>(
      "select id::text as id from auth.users order by id",
    );
    expect(owners.rows.map((row) => row.id)).toEqual([ALICE, BOB]);
  });

  it("deletes only the selected owner's conversation", async () => {
    const repository = createPgliteConversationRepository(async () => db);

    await repository.delete(ALICE, aliceOlder.id);

    await expect(repository.list(ALICE)).resolves.toEqual([aliceNewer]);
    await expect(repository.list(BOB)).resolves.toEqual([bobConversation]);
  });

  it("adds a new message without replacing the existing transcript", async () => {
    const repository = createPgliteConversationRepository(async () => db);
    // The previous test deleted aliceOlder; remove its leftover sibling so this
    // test observes only the transcript under test.
    await repository.delete(ALICE, aliceNewer.id);
    await repository.upsert(ALICE, updateFor(aliceOlder));
    const followUp: Conversation = {
      ...aliceOlder,
      updatedAt: 4_000,
      messages: [
        ...aliceOlder.messages,
        {
          id: "aaaaaaaa-0000-4000-8000-000000000013",
          role: "user",
          content: "Follow-up question",
          status: "done",
          createdAt: 4_001,
        },
      ],
    };

    await repository.upsert(ALICE, {
      conversation: { ...followUp, messages: [] },
      messages: [{ message: followUp.messages[2]!, sequence: 2 }],
    });

    await expect(repository.list(ALICE)).resolves.toEqual([followUp]);
  });

  it("rejects an invalid conversation update before writing", async () => {
    const repository = createPgliteConversationRepository(async () => db);
    const invalid = { ...updateFor(aliceOlder), conversation: { ...aliceOlder, title: "" } };
    const before = await repository.list(ALICE);

    await expect(repository.upsert(ALICE, invalid)).rejects.toThrow(
      /unsupported format/,
    );
    await expect(repository.list(ALICE)).resolves.toEqual(before);
  });

  it("skips a corrupt stored row without failing the whole history", async () => {
    const repository = createPgliteConversationRepository(async () => db);
    const before = await repository.list(ALICE);
    const corruptId = "cccccccc-0000-4000-8000-000000000001";

    await db.query(
      `insert into public.conversations (id, owner_id, title, updated_at_ms)
       values ($1, $2, 'Corrupt', 5000)`,
      [corruptId, ALICE],
    );
    await db.query(
      `insert into public.messages
         (id, conversation_id, owner_id, role, content, status, citations, sequence, created_at_ms)
       values ($1, $2, $3, 'assistant', 'Malformed citations', 'done',
               '{"id": 1}'::jsonb, 0, 5001)`,
      ["cccccccc-0000-4000-8000-000000000011", corruptId, ALICE],
    );

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(repository.list(ALICE)).resolves.toEqual(before);
      expect(log).toHaveBeenCalledWith(expect.stringContaining(corruptId));
    } finally {
      log.mockRestore();
      await db.query("delete from public.conversations where id = $1", [corruptId]);
    }
  });
});
