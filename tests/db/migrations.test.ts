import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MIGRATIONS_DIR,
  TestDatabase,
  seedTwoUsers,
} from "./harness";

describe("database migrations", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await TestDatabase.create();
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it("applies every migration in filename order", async () => {
    expect(db.migrationFiles()).toEqual([
      "0001_init_rag.sql",
      "0002_secure_user_access.sql",
      "0003_add_avatar_url.sql",
      "0004_api_rate_limits.sql",
      "0005_phase0_profile_updates_and_owner_index.sql",
      "0006_conversations_and_messages.sql",
      "0007_durable_ingestion.sql",
      "0008_retrieval_performance.sql",
      "0009_incremental_chat_and_worker.sql",
      "0010_worker_grants_and_bucket_privacy.sql",
      "0011_ingestion_lease_heartbeat.sql",
      "0012_ingestion_worker_schedule.sql",
    ]);
    expect(MIGRATIONS_DIR).toMatch(/supabase[\\/]migrations$/);
  });

  it("installs pgvector in the extensions schema", async () => {
    const extensions = await db.query<{ extname: string; schema: string }>(
      `select e.extname, n.nspname as schema
       from pg_extension e
       join pg_namespace n on n.oid = e.extnamespace
       where e.extname = 'vector'`,
    );

    expect(extensions).toEqual([{ extname: "vector", schema: "extensions" }]);
  });

  it("creates every expected table", async () => {
    const tables = await db.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
       order by table_name`,
    );

    expect(tables.map((table) => table.table_name)).toEqual(
      expect.arrayContaining([
        "api_rate_limits",
        "conversations",
        "document_chunks",
        "document_versions",
        "documents",
        "ingestion_jobs",
        "messages",
        "profiles",
        "storage_cleanup_queue",
      ]),
    );
  });

  it("stores document ownership and avatar columns required by the application", async () => {
    const columns = await db.query<{ table_name: string; column_name: string; is_nullable: string }>(
      `select table_name, column_name, is_nullable
       from information_schema.columns
       where table_schema = 'public'
         and (
           (table_name = 'documents' and column_name in (
             'owner_id', 'chunk_count', 'status', 'current_version_id', 'last_error', 'updated_at'
           ))
           or (table_name = 'profiles' and column_name in ('avatar_url', 'display_name'))
         )
       order by table_name, column_name`,
    );

    expect(columns).toEqual([
      { table_name: "documents", column_name: "chunk_count", is_nullable: "NO" },
      { table_name: "documents", column_name: "current_version_id", is_nullable: "YES" },
      { table_name: "documents", column_name: "last_error", is_nullable: "YES" },
      { table_name: "documents", column_name: "owner_id", is_nullable: "NO" },
      { table_name: "documents", column_name: "status", is_nullable: "NO" },
      { table_name: "documents", column_name: "updated_at", is_nullable: "NO" },
      { table_name: "profiles", column_name: "avatar_url", is_nullable: "YES" },
      { table_name: "profiles", column_name: "display_name", is_nullable: "NO" },
    ]);
  });

  it("creates the owner lookup and vector indexes", async () => {
    const indexes = await db.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef
       from pg_indexes
       where schemaname = 'public'
       order by indexname`,
    );
    const byName = new Map(indexes.map((index) => [index.indexname, index.indexdef]));

    expect(byName.has("documents_owner_id_idx")).toBe(true);
    expect(byName.has("document_chunks_document_id_idx")).toBe(true);
    expect(byName.get("document_chunks_embedding_idx")).toMatch(/using hnsw/i);
    expect(byName.has("profiles_email_lower_key")).toBe(true);
    expect(byName.has("document_versions_owner_checksum_key")).toBe(true);
    expect(byName.has("document_versions_document_idx")).toBe(true);
    expect(byName.has("document_chunks_version_index_key")).toBe(true);
    expect(byName.has("ingestion_jobs_due_idx")).toBe(true);
    expect(byName.has("ingestion_jobs_owner_created_idx")).toBe(true);
    expect(byName.has("storage_cleanup_queue_due_idx")).toBe(true);
  });

  it("enables row level security on every user-data table", async () => {
    const tables = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity
       from pg_class
       where relnamespace = 'public'::regnamespace
         and relkind = 'r'
         and relname in (
           'profiles', 'documents', 'document_chunks', 'api_rate_limits',
           'conversations', 'messages', 'document_versions', 'ingestion_jobs',
           'storage_cleanup_queue'
         )
       order by relname`,
    );

    expect(tables).toEqual([
      { relname: "api_rate_limits", relrowsecurity: true },
      { relname: "conversations", relrowsecurity: true },
      { relname: "document_chunks", relrowsecurity: true },
      { relname: "document_versions", relrowsecurity: true },
      { relname: "documents", relrowsecurity: true },
      { relname: "ingestion_jobs", relrowsecurity: true },
      { relname: "messages", relrowsecurity: true },
      { relname: "profiles", relrowsecurity: true },
      { relname: "storage_cleanup_queue", relrowsecurity: true },
    ]);
  });

  it("defines owner-scoped policies including the profile update policy", async () => {
    const policies = await db.query<{ tablename: string; policyname: string; cmd: string }>(
      `select tablename, policyname, cmd
       from pg_policies
       where schemaname = 'public'
       order by tablename, policyname`,
    );

    expect(policies).toEqual(
      expect.arrayContaining([
        { tablename: "profiles", policyname: "Users can read their profile", cmd: "SELECT" },
        { tablename: "profiles", policyname: "Users can update their own profile", cmd: "UPDATE" },
        { tablename: "documents", policyname: "Users can access their documents", cmd: "ALL" },
        {
          tablename: "document_chunks",
          policyname: "Users can access chunks from their documents",
          cmd: "ALL",
        },
        {
          tablename: "conversations",
          policyname: "Users can access their conversations",
          cmd: "ALL",
        },
        { tablename: "messages", policyname: "Users can access their messages", cmd: "ALL" },
        {
          tablename: "document_versions",
          policyname: "Users can access their document versions",
          cmd: "ALL",
        },
        {
          tablename: "ingestion_jobs",
          policyname: "Users can access their ingestion jobs",
          cmd: "ALL",
        },
        {
          tablename: "storage_cleanup_queue",
          policyname: "Users can access their storage cleanup queue",
          cmd: "ALL",
        },
      ]),
    );
  });

  it("grants only the intended table and column privileges", async () => {
    const [privileges] = await db.query<Record<string, boolean>>(
      `select
         has_table_privilege('authenticated', 'public.profiles', 'select') as profile_select,
         has_table_privilege('authenticated', 'public.profiles', 'update') as profile_table_update,
         has_column_privilege('authenticated', 'public.profiles', 'avatar_url', 'update') as profile_avatar_update,
         has_column_privilege('authenticated', 'public.profiles', 'display_name', 'update') as profile_name_update,
         has_table_privilege('authenticated', 'public.documents', 'select') as documents_select,
         has_table_privilege('authenticated', 'public.documents', 'insert') as documents_insert,
         has_table_privilege('authenticated', 'public.documents', 'delete') as documents_delete,
         has_table_privilege('authenticated', 'public.documents', 'update') as documents_update,
         has_column_privilege('authenticated', 'public.documents', 'status', 'update') as documents_status_update,
         has_column_privilege('authenticated', 'public.documents', 'name', 'update') as documents_name_update,
         has_table_privilege('authenticated', 'public.document_versions', 'select') as versions_select,
         has_table_privilege('authenticated', 'public.document_versions', 'insert') as versions_insert,
         has_table_privilege('authenticated', 'public.document_versions', 'update') as versions_update,
         has_table_privilege('authenticated', 'public.document_versions', 'delete') as versions_delete,
         has_table_privilege('authenticated', 'public.ingestion_jobs', 'select') as jobs_select,
         has_table_privilege('authenticated', 'public.ingestion_jobs', 'insert') as jobs_insert,
         has_table_privilege('authenticated', 'public.ingestion_jobs', 'update') as jobs_update,
         has_table_privilege('authenticated', 'public.ingestion_jobs', 'delete') as jobs_delete,
         has_table_privilege('authenticated', 'public.storage_cleanup_queue', 'select') as cleanup_select,
         has_table_privilege('authenticated', 'public.storage_cleanup_queue', 'insert') as cleanup_insert,
         has_table_privilege('authenticated', 'public.storage_cleanup_queue', 'delete') as cleanup_delete,
         has_table_privilege('anon', 'public.document_versions', 'select') as anon_versions_select,
         has_table_privilege('anon', 'public.ingestion_jobs', 'select') as anon_jobs_select,
         has_table_privilege('anon', 'public.storage_cleanup_queue', 'select') as anon_cleanup_select,
         has_table_privilege('anon', 'public.documents', 'select') as anon_documents_select,
         has_table_privilege('service_role', 'public.documents', 'select') as service_documents_select,
         has_table_privilege('authenticated', 'public.conversations', 'select') as conversations_select,
         has_table_privilege('authenticated', 'public.conversations', 'insert') as conversations_insert,
         has_table_privilege('authenticated', 'public.conversations', 'update') as conversations_update,
         has_table_privilege('authenticated', 'public.conversations', 'delete') as conversations_delete,
         has_table_privilege('authenticated', 'public.messages', 'select') as messages_select,
         has_table_privilege('authenticated', 'public.messages', 'insert') as messages_insert,
         has_table_privilege('authenticated', 'public.messages', 'update') as messages_update,
         has_table_privilege('authenticated', 'public.messages', 'delete') as messages_delete,
         has_table_privilege('anon', 'public.conversations', 'select') as anon_conversations_select,
         has_table_privilege('anon', 'public.messages', 'select') as anon_messages_select`,
    );

    expect(privileges).toEqual({
      profile_select: true,
      profile_table_update: false,
      profile_avatar_update: true,
      profile_name_update: false,
      documents_select: true,
      documents_insert: true,
      documents_delete: true,
      documents_update: false,
      documents_status_update: true,
      documents_name_update: false,
      versions_select: true,
      versions_insert: true,
      versions_update: true,
      versions_delete: true,
      jobs_select: true,
      jobs_insert: true,
      jobs_update: true,
      jobs_delete: true,
      cleanup_select: true,
      cleanup_insert: true,
      cleanup_delete: true,
      anon_versions_select: false,
      anon_jobs_select: false,
      anon_cleanup_select: false,
      anon_documents_select: false,
      service_documents_select: true,
      conversations_select: true,
      conversations_insert: true,
      conversations_update: true,
      conversations_delete: true,
      messages_select: true,
      messages_insert: true,
      messages_update: true,
      messages_delete: true,
      anon_conversations_select: false,
      anon_messages_select: false,
    });
  });

  it("restricts RPC execution to the authenticated role", async () => {
    const functions = await db.query<{
      proname: string;
      authenticated: boolean;
      anon: boolean;
      service_role: boolean;
    }>(
      `select
         p.proname,
         has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
         has_function_privilege('anon', p.oid, 'execute') as anon,
         has_function_privilege('service_role', p.oid, 'execute') as service_role
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'match_documents', 'consume_api_rate_limit', 'replace_conversations',
           'enqueue_document_ingestion', 'claim_ingestion_jobs', 'begin_ingestion_attempt',
           'complete_ingestion_job', 'fail_ingestion_job', 'retry_ingestion_job',
           'delete_document_for_owner', 'claim_storage_cleanup',
           'complete_storage_cleanup', 'fail_storage_cleanup',
           'upsert_conversation_messages'
         )
       order by p.proname`,
    );

    expect(functions.map((fn) => fn.proname)).toEqual([
      "begin_ingestion_attempt",
      "claim_ingestion_jobs",
      "claim_storage_cleanup",
      "complete_ingestion_job",
      "complete_storage_cleanup",
      "consume_api_rate_limit",
      "delete_document_for_owner",
      "enqueue_document_ingestion",
      "fail_ingestion_job",
      "fail_storage_cleanup",
      "match_documents",
      "replace_conversations",
      "retry_ingestion_job",
      "upsert_conversation_messages",
    ]);
    const workerFunctions = new Set([
      "begin_ingestion_attempt",
      "claim_ingestion_jobs",
      "claim_storage_cleanup",
      "complete_ingestion_job",
      "complete_storage_cleanup",
      "fail_ingestion_job",
      "fail_storage_cleanup",
    ]);
    for (const fn of functions) {
      expect(fn.anon).toBe(false);
      if (workerFunctions.has(fn.proname)) {
        // Worker RPCs are service-role only (migration 0010).
        expect(fn.authenticated).toBe(false);
        expect(fn.service_role).toBe(true);
      } else if (fn.proname === "replace_conversations") {
        expect(fn.authenticated).toBe(false);
        expect(fn.service_role).toBe(false);
      } else {
        expect(fn.authenticated).toBe(true);
        expect(fn.service_role).toBe(false);
      }
    }

    const upsert = functions.find((fn) => fn.proname === "upsert_conversation_messages");
    expect(upsert).toMatchObject({ authenticated: true, service_role: false });
  });

  it("creates profiles through the auth.users trigger", async () => {
    await seedTwoUsers(db);

    const profiles = await db.query<{ email: string; display_name: string }>(
      `select email, display_name from public.profiles order by email`,
    );

    expect(profiles).toEqual([
      { email: "alice@example.test", display_name: "Alice" },
      { email: "bob@example.test", display_name: "Bob" },
    ]);
  });
});
