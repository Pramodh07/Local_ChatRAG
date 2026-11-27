import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

/**
 * Harness fidelity note: this applies the real SQL migrations to plain PGlite
 * with minimal auth/role stubs, but it does not model PostgREST, Storage, or
 * pg_cron/vault. Hosted Supabase behaviour (default grants, Storage policies,
 * row caps) must be verified against a staging project. Worker grants are
 * asserted through migration 0010 rather than added here, so a grant regression
 * fails the suite instead of being masked by the harness.
 */
export const MIGRATIONS_DIR = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "supabase",
  "migrations",
);

export const EMBEDDING_DIMENSIONS = 1536;

export type SupabaseRole = "anon" | "authenticated" | "service_role";

export type TestUser = {
  id: string;
  email: string;
};

export const TEST_USERS = {
  alice: { id: "11111111-1111-4111-8111-111111111111", email: "alice@example.test" },
  bob: { id: "22222222-2222-4222-8222-222222222222", email: "bob@example.test" },
} as const satisfies Record<string, TestUser>;

export const TEST_DOCUMENTS = {
  alice: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  bob: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
} as const;

export const TEST_CONVERSATIONS = {
  alice: "aaaaaaaa-0000-4000-8000-000000000001",
  bob: "bbbbbbbb-0000-4000-8000-000000000002",
} as const;

export const TEST_MESSAGES = {
  aliceUser: "aaaaaaaa-0000-4000-8000-000000000011",
  aliceAssistant: "aaaaaaaa-0000-4000-8000-000000000012",
  bobUser: "bbbbbbbb-0000-4000-8000-000000000021",
} as const;

/**
 * Minimal Supabase-compatible auth stubs.
 *
 * Hosted Supabase provides `auth.users`, `auth.uid()`, and the `anon`,
 * `authenticated`, and `service_role` roles. PGlite is plain PostgreSQL, so the
 * test harness recreates just enough of that contract to execute the real
 * migrations and RLS policies.
 *
 * `auth.uid()` mirrors Supabase: it reads the request-scoped JWT subject from a
 * GUC, so tests can switch identity with `set_config(..., true)`.
 */
const SUPABASE_STUBS = `
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'create role anon nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'create role authenticated nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'create role service_role nologin bypassrls';
  end if;
end
$roles$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
`;

export type TestDatabaseOptions = {
  /** Apply every migration after the Supabase stubs. Disable for guard tests. */
  applyMigrations?: boolean;
};

export class ScopedDatabase {
  constructor(private readonly db: PGlite) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.db.query<T>(sql, params);
    return result.rows;
  }
}

export class TestDatabase {
  private constructor(private readonly db: PGlite) {}

  static async create(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
    const db = new PGlite({ extensions: { vector } });
    const instance = new TestDatabase(db);
    await db.waitReady;
    await db.exec(SUPABASE_STUBS);
    if (options.applyMigrations !== false) {
      await instance.applyMigrations();
    }
    return instance;
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.db.query<T>(sql, params);
    return result.rows;
  }

  migrationFiles(): string[] {
    return readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort();
  }

  async applyMigrations(): Promise<string[]> {
    const files = this.migrationFiles();
    for (const name of files) {
      await this.applyMigration(name);
    }
    return files;
  }

  async applyMigration(name: string): Promise<void> {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
    await this.db.exec(sql);
  }

  /**
   * Run a callback as a specific Supabase role and JWT subject.
   *
   * The transaction is rolled back by default, so tests can exercise inserts,
   * updates, deletes, and RLS failures without leaking state between tests.
   * Pass `{ commit: true }` when a test must verify persisted state.
   * `userId: null` simulates an authenticated request without a valid subject.
   */
  async runAs<T>(
    role: SupabaseRole,
    userId: string | null,
    operation: (scoped: ScopedDatabase) => Promise<T>,
    options: { commit?: boolean } = {},
  ): Promise<T> {
    await this.db.exec("begin");
    try {
      await this.db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
      await this.db.exec(`set local role ${role}`);
      const result = await operation(new ScopedDatabase(this.db));
      await this.db.exec(options.commit ? "commit" : "rollback");
      return result;
    } catch (error) {
      await this.db.exec("rollback").catch(() => undefined);
      throw error;
    }
  }
}

/**
 * Deterministic 1536-dimension unit vector.
 *
 * Cosine similarity between two different seeds is 0, and a vector compared to
 * itself is 1, which makes retrieval assertions stable.
 */
export function embedding(seed: number): string {
  const values = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const primary = seed % EMBEDDING_DIMENSIONS;
  const secondary = (seed + 1) % EMBEDDING_DIMENSIONS;
  values[primary] = 1;
  values[secondary] = 0.5;
  return `[${values.join(",")}]`;
}

export async function seedTwoUsers(db: TestDatabase): Promise<void> {
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data)
     values ($1, $2, $3::jsonb), ($4, $5, $6::jsonb)`,
    [
      TEST_USERS.alice.id,
      TEST_USERS.alice.email,
      JSON.stringify({ display_name: "Alice" }),
      TEST_USERS.bob.id,
      TEST_USERS.bob.email,
      JSON.stringify({ display_name: "Bob" }),
    ],
  );
}

export async function seedTwoDocuments(db: TestDatabase): Promise<void> {
  await db.query(
    `insert into public.documents (id, owner_id, name, mime_type, chunk_count)
     values ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)`,
    [
      TEST_DOCUMENTS.alice,
      TEST_USERS.alice.id,
      "Alice notes",
      "text/markdown",
      2,
      TEST_DOCUMENTS.bob,
      TEST_USERS.bob.id,
      "Bob notes",
      "text/plain",
      1,
    ],
  );

  await db.query(
    `insert into public.document_chunks (document_id, page, section, content, embedding)
     values
       ($1, 1, 'Overview', 'Alice revenue was 10 units.', $2::extensions.vector),
       ($1, 2, 'Details', 'Alice revenue grew by 5 percent.', $3::extensions.vector),
       ($4, 1, 'Overview', 'Bob revenue was 99 units.', $5::extensions.vector)`,
    [
      TEST_DOCUMENTS.alice,
      embedding(0),
      embedding(2),
      TEST_DOCUMENTS.bob,
      embedding(10),
    ],
  );
}

export async function seedConversations(db: TestDatabase): Promise<void> {
  await db.query(
    `insert into public.conversations (id, owner_id, title, updated_at_ms)
     values ($1, $2, 'Alice chat', 1000), ($3, $4, 'Bob chat', 2000)`,
    [
      TEST_CONVERSATIONS.alice,
      TEST_USERS.alice.id,
      TEST_CONVERSATIONS.bob,
      TEST_USERS.bob.id,
    ],
  );

  await db.query(
    `insert into public.messages
       (id, conversation_id, owner_id, role, content, status, sequence, created_at_ms)
     values
       ($1, $2, $3, 'user', 'Alice question', 'done', 0, 1001),
       ($4, $2, $3, 'assistant', 'Alice answer', 'done', 1, 1002),
       ($5, $6, $7, 'user', 'Bob question', 'done', 0, 2001)`,
    [
      TEST_MESSAGES.aliceUser,
      TEST_CONVERSATIONS.alice,
      TEST_USERS.alice.id,
      TEST_MESSAGES.aliceAssistant,
      TEST_MESSAGES.bobUser,
      TEST_CONVERSATIONS.bob,
      TEST_USERS.bob.id,
    ],
  );
}

export async function seedDatabase(db: TestDatabase): Promise<void> {
  await seedTwoUsers(db);
  await seedTwoDocuments(db);
  await seedConversations(db);
}
