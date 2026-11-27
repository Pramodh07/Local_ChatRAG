import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createJsonStore } from "@/modules/shared/lib/json-store";
import { isRecord } from "@/modules/shared/lib/guards";
import { applyLocalMigrations } from "@/modules/shared/integrations/pglite-bootstrap";
import {
  createTestLocalDatabase,
  MIGRATION_DIRECTORIES,
} from "./helpers/pglite";

type CounterStore = {
  version: 1;
  values: string[];
};

function isCounterStore(value: unknown): value is CounterStore {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.values) &&
    value.values.every((entry) => typeof entry === "string")
  );
}

function counterStore(db: () => Promise<PGlite>, fileName: string) {
  return createJsonStore<CounterStore>({
    fileName,
    createEmpty: () => ({ version: 1, values: [] }),
    validate: isCounterStore,
    invalidJsonMessage: "Invalid JSON.",
    unsupportedFormatMessage: "Unsupported format.",
    backend: "postgres",
    database: db,
  });
}

describe("embedded local PostgreSQL runtime", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestLocalDatabase();
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it("applies shared and local migrations once", async () => {
    const result = await applyLocalMigrations(db, MIGRATION_DIRECTORIES);

    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(13);

    const migrations = await db.query<{ name: string }>(
      "select name from local.schema_migrations order by name",
    );
    expect(migrations.rows.map((row) => row.name)).toEqual([
      "local/0001_local_store.sql",
      "shared/0001_init_rag.sql",
      "shared/0002_secure_user_access.sql",
      "shared/0003_add_avatar_url.sql",
      "shared/0004_api_rate_limits.sql",
      "shared/0005_phase0_profile_updates_and_owner_index.sql",
      "shared/0006_conversations_and_messages.sql",
      "shared/0007_durable_ingestion.sql",
      "shared/0008_retrieval_performance.sql",
      "shared/0009_incremental_chat_and_worker.sql",
      "shared/0010_worker_grants_and_bucket_privacy.sql",
      "shared/0011_ingestion_lease_heartbeat.sql",
      "shared/0012_ingestion_worker_schedule.sql",
    ]);
  });

  it("stores validated documents in local.json_stores", async () => {
    const store = counterStore(async () => db, "runtime-test.json");

    await expect(store.read()).resolves.toEqual({ version: 1, values: [] });

    await store.mutate((value) => {
      value.values.push("first");
      return { result: undefined, changed: true };
    });

    await expect(store.read()).resolves.toEqual({ version: 1, values: ["first"] });

    const stored = await db.query<{ content: CounterStore }>(
      "select content from local.json_stores where name = $1",
      ["runtime-test.json"],
    );
    expect(stored.rows[0].content).toEqual({ version: 1, values: ["first"] });
  });

  it("serializes concurrent mutations", async () => {
    const store = counterStore(async () => db, "runtime-concurrent.json");

    await Promise.all([
      store.mutate((value) => {
        value.values.push("a");
        return { result: undefined, changed: true };
      }),
      store.mutate((value) => {
        value.values.push("b");
        return { result: undefined, changed: true };
      }),
    ]);

    const value = await store.read();
    expect(value.values).toHaveLength(2);
    expect([...value.values].sort()).toEqual(["a", "b"]);
  });

  it("rejects a stored document with an unsupported format", async () => {
    await db.query(
      `insert into local.json_stores (name, content)
       values ('runtime-invalid.json', $1::jsonb)`,
      [JSON.stringify({ version: 2, values: [] })],
    );

    const store = counterStore(async () => db, "runtime-invalid.json");
    await expect(store.read()).rejects.toThrow("Unsupported format.");
  });

  it("fails when an applied migration file changes", async () => {
    const shared = await mkdtemp(path.join(tmpdir(), "atlas-shared-"));
    const local = await mkdtemp(path.join(tmpdir(), "atlas-local-"));
    const migration = path.join(local, "0001_test.sql");

    try {
      await writeFile(migration, "create table if not exists local.check_one (id int);");
      await applyLocalMigrations(db, { shared, local });

      await writeFile(migration, "create table if not exists local.check_one (id bigint);");
      await expect(applyLocalMigrations(db, { shared, local })).rejects.toThrow(
        /changed after it was applied/,
      );
    } finally {
      await rm(shared, { recursive: true, force: true });
      await rm(local, { recursive: true, force: true });
    }
  });
});
