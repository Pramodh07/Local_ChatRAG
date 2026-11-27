import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TestDatabase,
  TEST_CONVERSATIONS,
  TEST_DOCUMENTS,
  TEST_MESSAGES,
  TEST_USERS,
  embedding,
  seedDatabase,
} from "./harness";

const ALICE = TEST_USERS.alice.id;
const BOB = TEST_USERS.bob.id;

describe("row level security", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await TestDatabase.create();
    await seedDatabase(db);
  }, 60_000);

  afterAll(async () => {
    await db.exec("delete from public.api_rate_limits");
    await db.close();
  });

  describe("documents", () => {
    it("shows each owner only their own documents", async () => {
      const aliceRows = await db.runAs("authenticated", ALICE, (scoped) =>
        scoped.query<{ id: string; name: string }>(
          `select id, name from public.documents order by name`,
        ),
      );
      const bobRows = await db.runAs("authenticated", BOB, (scoped) =>
        scoped.query<{ id: string; name: string }>(
          `select id, name from public.documents order by name`,
        ),
      );

      expect(aliceRows).toEqual([{ id: TEST_DOCUMENTS.alice, name: "Alice notes" }]);
      expect(bobRows).toEqual([{ id: TEST_DOCUMENTS.bob, name: "Bob notes" }]);
    });

    it("returns nothing when another owner's document is requested by id", async () => {
      const rows = await db.runAs("authenticated", ALICE, (scoped) =>
        scoped.query<{ id: string }>(`select id from public.documents where id = $1`, [
          TEST_DOCUMENTS.bob,
        ]),
      );

      expect(rows).toEqual([]);
    });

    it("allows inserting an own document and rejects a forged owner_id", async () => {
      const inserted = await db.runAs("authenticated", ALICE, (scoped) =>
        scoped.query<{ id: string }>(
          `insert into public.documents (id, owner_id, name, mime_type, chunk_count)
           values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', $1, 'Alice upload', 'text/plain', 1)
           returning id`,
          [ALICE],
        ),
      );
      expect(inserted).toEqual([{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }]);

      await expect(
        db.runAs("authenticated", ALICE, (scoped) =>
          scoped.query(
            `insert into public.documents (id, owner_id, name, mime_type, chunk_count)
             values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', $1, 'Forged', 'text/plain', 1)`,
            [BOB],
          ),
        ),
      ).rejects.toThrow(/row-level security policy/);
    });

    it("allows lifecycle updates but rejects metadata rewrites", async () => {
      const updated = await db.runAs("authenticated", ALICE, (scoped) =>
        scoped.query<{ status: string }>(
          `update public.documents set status = 'processing' where id = $1 returning status`,
          [TEST_DOCUMENTS.alice],
        ),
      );
      expect(updated).toEqual([{ status: "processing" }]);

      await expect(
        db.runAs("authenticated", ALICE, (scoped) =>
          scoped.query(`update public.documents set name = 'Renamed' where id = $1`, [
            TEST_DOCUMENTS.alice,
          ]),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it("deletes only the owner's document and cascades its chunks", async () => {
      const deletedOther = await db.runAs("authenticated", ALICE, (scoped) =>
        scoped.query<{ id: string }>(
          `delete from public.documents where id = $1 returning id`,
          [TEST_DOCUMENTS.bob],
        ),
      );
      expect(deletedOther).toEqual([]);

      const result = await db.runAs("authenticated", ALICE, async (scoped) => {
        const deletedOwn = await scoped.query<{ id: string }>(
          `delete from public.documents where id = $1 returning id`,
          [TEST_DOCUMENTS.alice],
        );
        const [chunks] = await scoped.query<{ count: number }>(
          `select count(*)::int as count from public.document_chunks`,
        );
        return { deletedOwn, chunks: chunks.count };
      });

      expect(result.deletedOwn).toEqual([{ id: TEST_DOCUMENTS.alice }]);
      expect(result.chunks).toBe(0);
    });
  });

  describe("document chunks", () => {
    it("shows only chunks that belong to the owner's documents", async () => {
      const aliceChunks = await db.runAs("authenticated", ALICE, (scoped) =>
        scoped.query<{ content: string }>(
          `select content from public.document_chunks order by id`,
        ),
      );

      expect(aliceChunks.map((chunk) => chunk.content)).toEqual([
        "Alice revenue was 10 units.",
        "Alice revenue grew by 5 percent.",
      ]);
    });

    it("rejects inserting a chunk into another owner's document", async () => {
      await expect(
        db.runAs("authenticated", ALICE, (scoped) =>
          scoped.query(
            `insert into public.document_chunks (document_id, content, embedding)
             values ($1, 'Injected', $2::extensions.vector)`,
            [TEST_DOCUMENTS.bob, embedding(5)],
          ),
        ),
      ).rejects.toThrow(/row-level security policy/);
    });
  });

  describe("retrieval", () => {
    it("returns only the caller's chunks when the query matches another owner's evidence", async () => {
      const results = await db.runAs("authenticated", ALICE, (scoped) =>
        scoped.query<{ document_id: string; similarity: number }>(
          `select document_id, similarity
           from public.match_documents($1::extensions.vector, 5, 0.25)`,
          [embedding(10)],
        ),
      );

      expect(results).toEqual([]);
    });

    it("returns the caller's own matching chunk", async () => {
      const results = await db.runAs("authenticated", ALICE, (scoped) =>
        scoped.query<{ document_id: string; similarity: number }>(
          `select document_id, similarity
           from public.match_documents($1::extensions.vector, 5, 0.25)`,
          [embedding(0)],
        ),
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.document_id).toBe(TEST_DOCUMENTS.alice);
      expect(results[0]?.similarity).toBeCloseTo(1, 5);
    });

    it("returns nothing when an authenticated request has no subject", async () => {
      const results = await db.runAs("authenticated", null, (scoped) =>
        scoped.query(`select * from public.match_documents($1::extensions.vector, 5, 0.25)`, [
          embedding(0),
        ]),
      );

      expect(results).toEqual([]);
    });

    it("denies anonymous retrieval", async () => {
      // The raw SQL caller needs USAGE on the `extensions` schema to name the
      // vector type, so anon is stopped there before the revoked EXECUTE check.
      // Either denial proves the anonymous path cannot retrieve documents.
      await expect(
        db.runAs("anon", null, (scoped) =>
          scoped.query(`select * from public.match_documents($1::extensions.vector, 5, 0.25)`, [
            embedding(0),
          ]),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe("write isolation", () => {
    it("blocks anonymous reads and writes", async () => {
      await expect(
        db.runAs("anon", null, (scoped) => scoped.query(`select * from public.documents`)),
      ).rejects.toThrow(/permission denied for table/);

      await expect(
        db.runAs("anon", null, (scoped) =>
          scoped.query(
            `insert into public.documents (id, owner_id, name, mime_type, chunk_count)
             values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', $1, 'Anon', 'text/plain', 1)`,
            [ALICE],
          ),
        ),
      ).rejects.toThrow(/permission denied for table/);
    });

    it("lets service_role read across owners", async () => {
      const rows = await db.runAs("service_role", null, (scoped) =>
        scoped.query<{ id: string }>(`select id from public.documents order by id`),
      );

      expect(rows).toHaveLength(2);
    });
  });

  describe("conversations", () => {
    it("shows each owner only their own conversations and messages", async () => {
      const alice = await db.runAs("authenticated", ALICE, async (scoped) => {
        const conversations = await scoped.query<{ id: string; title: string }>(
          `select id, title from public.conversations order by updated_at_ms`,
        );
        const messages = await scoped.query<{ content: string }>(
          `select content from public.messages order by sequence`,
        );
        return { conversations, messages };
      });
      const bob = await db.runAs("authenticated", BOB, async (scoped) => ({
        conversations: await scoped.query<{ id: string }>(`select id from public.conversations`),
        messages: await scoped.query<{ content: string }>(`select content from public.messages`),
      }));

      expect(alice.conversations).toEqual([
        { id: TEST_CONVERSATIONS.alice, title: "Alice chat" },
      ]);
      expect(alice.messages.map((message) => message.content)).toEqual([
        "Alice question",
        "Alice answer",
      ]);
      expect(bob.conversations).toEqual([{ id: TEST_CONVERSATIONS.bob }]);
      expect(bob.messages.map((message) => message.content)).toEqual(["Bob question"]);
    });

    it("returns nothing when another owner's conversation or message is requested", async () => {
      const conversations = await db.runAs("authenticated", ALICE, (scoped) =>
        scoped.query(`select id from public.conversations where id = $1`, [TEST_CONVERSATIONS.bob]),
      );
      const messages = await db.runAs("authenticated", ALICE, (scoped) =>
        scoped.query(`select id from public.messages where conversation_id = $1`, [
          TEST_CONVERSATIONS.bob,
        ]),
      );

      expect(conversations).toEqual([]);
      expect(messages).toEqual([]);
    });

    it("rejects a forged conversation owner and a message inside another owner's conversation", async () => {
      await expect(
        db.runAs("authenticated", ALICE, (scoped) =>
          scoped.query(
            `insert into public.conversations (id, owner_id, title, updated_at_ms)
             values ('cccccccc-0000-4000-8000-000000000003', $1, 'Forged', 1)`,
            [BOB],
          ),
        ),
      ).rejects.toThrow(/row-level security policy/);

      await expect(
        db.runAs("authenticated", ALICE, (scoped) =>
          scoped.query(
            `insert into public.messages
               (id, conversation_id, owner_id, role, content, status, sequence, created_at_ms)
             values ('cccccccc-0000-4000-8000-000000000013', $1, $2, 'user', 'Injected', 'done', 9, 1)`,
            [TEST_CONVERSATIONS.bob, ALICE],
          ),
        ),
      ).rejects.toThrow(/row-level security policy/);
    });

    it("deletes only the owner's conversation and cascades its messages", async () => {
      const result = await db.runAs("authenticated", ALICE, async (scoped) => {
        const deletedOther = await scoped.query<{ id: string }>(
          `delete from public.conversations where id = $1 returning id`,
          [TEST_CONVERSATIONS.bob],
        );
        const deletedOwn = await scoped.query<{ id: string }>(
          `delete from public.conversations where id = $1 returning id`,
          [TEST_CONVERSATIONS.alice],
        );
        const [messages] = await scoped.query<{ count: number }>(
          `select count(*)::int as count from public.messages`,
        );
        return { deletedOther, deletedOwn, messages: messages.count };
      });

      expect(result.deletedOther).toEqual([]);
      expect(result.deletedOwn).toEqual([{ id: TEST_CONVERSATIONS.alice }]);
      expect(result.messages).toBe(0);
    });

    it("adds messages without deleting existing history", async () => {
      const saved = await db.runAs("authenticated", ALICE, async (scoped) => {
        const [result] = await scoped.query<{ saved: number }>(
          `select public.upsert_conversation_messages($1::uuid, $2::jsonb, $3::jsonb) as saved`,
          [
            ALICE,
            JSON.stringify({
              id: TEST_CONVERSATIONS.alice,
              title: "Alice chat",
              updatedAt: 5000,
            }),
            JSON.stringify([
              {
                id: "aaaaaaaa-0000-4000-8000-000000000041",
                role: "user",
                content: "New question",
                status: "done",
                createdAt: 5001,
                sequence: 2,
              },
            ]),
          ],
        );
        const conversations = await scoped.query<{ id: string; title: string }>(
          `select id, title from public.conversations where id = $1`,
          [TEST_CONVERSATIONS.alice],
        );
        const messages = await scoped.query<{ content: string }>(
          `select content from public.messages
           where conversation_id = $1
           order by sequence, created_at_ms, id`,
          [TEST_CONVERSATIONS.alice],
        );
        return { result, conversations, messages };
      });

      expect(saved.result).toEqual({ saved: 1 });
      expect(saved.conversations).toEqual([
        { id: TEST_CONVERSATIONS.alice, title: "Alice chat" },
      ]);
      expect(saved.messages.map((message) => message.content)).toEqual([
        "Alice question",
        "Alice answer",
        "New question",
      ]);
    });

    it("rejects a forged owner or malformed incremental payload", async () => {
      await expect(
        db.runAs("authenticated", ALICE, (scoped) =>
          scoped.query(
            `select public.upsert_conversation_messages($1::uuid, '{}'::jsonb, '[]'::jsonb)`,
            [BOB],
          ),
        ),
      ).rejects.toThrow(/does not match the authenticated user/);

      await expect(
        db.runAs("authenticated", ALICE, (scoped) =>
          scoped.query(
            `select public.upsert_conversation_messages($1::uuid, '{}'::jsonb, '{}'::jsonb)`,
            [ALICE],
          ),
        ),
      ).rejects.toThrow(/invalid format/);
    });
  });

  describe("profiles", () => {
    it("shows each user only their own profile", async () => {
      const own = await db.runAs("authenticated", ALICE, (scoped) =>
        scoped.query<{ email: string }>(`select email from public.profiles`),
      );
      const other = await db.runAs("authenticated", ALICE, (scoped) =>
        scoped.query<{ id: string }>(`select id from public.profiles where id = $1`, [BOB]),
      );

      expect(own).toEqual([{ email: "alice@example.test" }]);
      expect(other).toEqual([]);
    });

    it("allows updating the caller's avatar", async () => {
      const updated = await db.runAs("authenticated", ALICE, (scoped) =>
        scoped.query<{ avatar_url: string }>(
          `update public.profiles
           set avatar_url = 'data:image/png;base64,AAAA'
           where id = $1
           returning avatar_url`,
          [ALICE],
        ),
      );

      expect(updated).toEqual([{ avatar_url: "data:image/png;base64,AAAA" }]);
    });

    it("cannot update another user's profile or a non-granted column", async () => {
      const updatedOther = await db.runAs("authenticated", ALICE, (scoped) =>
        scoped.query<{ id: string }>(
          `update public.profiles set avatar_url = 'x' where id = $1 returning id`,
          [BOB],
        ),
      );
      expect(updatedOther).toEqual([]);

      await expect(
        db.runAs("authenticated", ALICE, (scoped) =>
          scoped.query(`update public.profiles set display_name = 'Renamed' where id = $1`, [ALICE]),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it("blocks profile inserts and anonymous reads", async () => {
      await expect(
        db.runAs("authenticated", ALICE, (scoped) =>
          scoped.query(`insert into public.profiles (id, display_name) values ($1, 'x')`, [ALICE]),
        ),
      ).rejects.toThrow(/permission denied/);

      await expect(
        db.runAs("anon", null, (scoped) => scoped.query(`select * from public.profiles`)),
      ).rejects.toThrow(/permission denied for table/);
    });
  });

  describe("api rate limits", () => {
    it("allows the configured chat budget and then blocks with a retry hint", async () => {
      const outcomes = await db.runAs(
        "authenticated",
        ALICE,
        async (scoped) => {
          const results: { allowed: boolean; retry_after_seconds: number }[] = [];
          for (let attempt = 0; attempt < 21; attempt += 1) {
            const [row] = await scoped.query<{ allowed: boolean; retry_after_seconds: number }>(
              `select allowed, retry_after_seconds from public.consume_api_rate_limit('chat')`,
            );
            if (row) results.push(row);
          }
          return results;
        },
        { commit: true },
      );

      expect(outcomes).toHaveLength(21);
      expect(outcomes.slice(0, 20).every((row) => row.allowed)).toBe(true);
      expect(outcomes[20]?.allowed).toBe(false);
      expect(outcomes[20]?.retry_after_seconds).toBeGreaterThan(0);

      const [stored] = await db.query<{ count: number }>(
        `select count(*)::int as count
         from public.api_rate_limits
         where user_id = $1 and action = 'chat'`,
        [ALICE],
      );
      expect(stored?.count).toBe(1);
    });

    it("rejects unknown actions and anonymous or subject-less callers", async () => {
      await expect(
        db.runAs("authenticated", ALICE, (scoped) =>
          scoped.query(`select * from public.consume_api_rate_limit('unknown')`),
        ),
      ).rejects.toThrow(/Unsupported API rate-limit action/);

      await expect(
        db.runAs("authenticated", null, (scoped) =>
          scoped.query(`select * from public.consume_api_rate_limit('chat')`),
        ),
      ).rejects.toThrow(/Authentication is required/);

      await expect(
        db.runAs("anon", null, (scoped) =>
          scoped.query(`select * from public.consume_api_rate_limit('chat')`),
        ),
      ).rejects.toThrow(/permission denied for function/);
    });
  });
});
