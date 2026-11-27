import { describe, expect, it } from "vitest";
import { TestDatabase } from "./harness";

describe("migration safety guards", () => {
  it(
    "refuses to apply 0002 when existing documents have no owner",
    async () => {
      const db = await TestDatabase.create({ applyMigrations: false });
      try {
        await db.applyMigration("0001_init_rag.sql");
        await db.query(
          `insert into public.documents (id, name, mime_type, chunk_count)
           values ('99999999-9999-4999-8999-999999999999', 'Legacy', 'text/plain', 1)`,
        );

        await expect(db.applyMigration("0002_secure_user_access.sql")).rejects.toThrow(
          /Assign existing documents to their owner/,
        );
      } finally {
        await db.close();
      }
    },
    60_000,
  );

  it(
    "applies every migration after the unowned-document guard is satisfied",
    async () => {
      const db = await TestDatabase.create({ applyMigrations: false });
      try {
        const applied = [];
        for (const name of db.migrationFiles()) {
          await db.applyMigration(name);
          applied.push(name);
        }

        const [state] = await db.query<{ documents: number; owner_index: number }>(
          `select
             (select count(*)::int from public.documents) as documents,
             (select count(*)::int from pg_indexes
              where schemaname = 'public' and indexname = 'documents_owner_id_idx') as owner_index`,
        );

        expect(applied).toHaveLength(db.migrationFiles().length);
        expect(state).toEqual({ documents: 0, owner_index: 1 });
      } finally {
        await db.close();
      }
    },
    60_000,
  );
});
