import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { afterAll, describe, expect, it } from "vitest";
import { WEB_ROOT } from "./helpers/pglite";

const FIXTURE_DIR = path.join(WEB_ROOT, "tests", "fixtures", "local-data");
const IMPORTER = path.join(WEB_ROOT, "scripts", "import-local-data.mjs");

function runImporter(dataDir: string, extra: string[] = []) {
  return spawnSync(
    process.execPath,
    [IMPORTER, "--source", FIXTURE_DIR, "--data-dir", dataDir, ...extra],
    {
      cwd: WEB_ROOT,
      encoding: "utf8",
      timeout: 120_000,
    },
  );
}

async function openDatabase(dataDir: string) {
  const db = new PGlite({ dataDir, extensions: { vector } });
  await db.waitReady;
  return db;
}

describe("local data importer", () => {
  let dataDir: string | null = null;

  afterAll(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("imports validated records without modifying the source files", async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "atlas-import-"));
    const sourceBefore = await Promise.all(
      ["auth-store.json", "account-store.json", "conversation-store.json"].map((name) =>
        readFile(path.join(FIXTURE_DIR, name), "utf8"),
      ),
    );

    const first = runImporter(dataDir);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("Imported from");

    const db = await openDatabase(dataDir);
    try {
      const conversationCount = await db.query<{ count: number }>(
        "select count(*)::integer as count from public.conversations",
      );
      expect(conversationCount.rows[0].count).toBe(2);

      const messageCount = await db.query<{ count: number }>(
        "select count(*)::integer as count from public.messages",
      );
      expect(messageCount.rows[0].count).toBe(3);

      const profileCount = await db.query<{ count: number }>(
        "select count(*)::integer as count from public.profiles",
      );
      expect(profileCount.rows[0].count).toBe(2);

      const stores = await db.query<{ name: string }>(
        "select name from local.json_stores order by name",
      );
      expect(stores.rows.map((row) => row.name)).toEqual([
        "account-store.json",
        "auth-store.json",
      ]);

      const citations = await db.query<{ citations: unknown }>(
        "select citations from public.messages where tokens = 42",
      );
      expect(citations.rows[0].citations).toEqual([
        {
          id: 1,
          doc: "notes.md",
          page: 2,
          section: "Overview",
          excerpt: "Revenue grew.",
          score: 0.91,
        },
      ]);

      const archived = await db.query<{ archived_at_ms: number }>(
        `select archived_at_ms::double precision as archived_at_ms
         from public.conversations
         where title = 'Bob notes'`,
      );
      expect(archived.rows[0].archived_at_ms).toBe(2500);
    } finally {
      await db.close();
    }

    const sourceAfter = await Promise.all(
      ["auth-store.json", "account-store.json", "conversation-store.json"].map((name) =>
        readFile(path.join(FIXTURE_DIR, name), "utf8"),
      ),
    );
    expect(sourceAfter).toEqual(sourceBefore);
  }, 60_000);

  it("refuses to overwrite existing records without --force", async () => {
    if (!dataDir) throw new Error("Import test did not create a data directory.");

    const second = runImporter(dataDir);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain("already contains");

    const forced = runImporter(dataDir, ["--force"]);
    expect(forced.status, forced.stderr).toBe(0);

    const db = await openDatabase(dataDir);
    try {
      const counts = await db.query<{ conversations: number; messages: number }>(
        `select
           (select count(*)::integer from public.conversations) as conversations,
           (select count(*)::integer from public.messages) as messages`,
      );
      expect(counts.rows[0]).toEqual({ conversations: 2, messages: 3 });
    } finally {
      await db.close();
    }
  }, 60_000);
});
