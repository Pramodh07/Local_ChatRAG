import "server-only";

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { getDatabaseProvider } from "@/modules/shared/config/providers";
import { applyLocalMigrations } from "@/modules/shared/integrations/pglite-bootstrap";

type PGliteGlobal = typeof globalThis & {
  __atlasLocalDatabase?: Promise<PGlite>;
};

const globalForPglite = globalThis as PGliteGlobal;

function isMemoryDirectory(dataDir: string): boolean {
  return dataDir.startsWith("memory://") || dataDir.startsWith("idb://");
}

export function localDatabaseDataDirectory(): string {
  const configured = process.env.PGLITE_DATA_DIR?.trim();
  return configured || path.join(process.cwd(), ".local-data", "pglite");
}

export function isLocalPostgresEnabled(): boolean {
  return getDatabaseProvider() === "postgres";
}

async function createDatabase(): Promise<PGlite> {
  const dataDir = localDatabaseDataDirectory();
  if (!isMemoryDirectory(dataDir)) {
    await mkdir(path.dirname(dataDir), { recursive: true, mode: 0o700 });
  }

  const db = new PGlite({ dataDir, extensions: { vector } });
  await db.waitReady;
  await applyLocalMigrations(db, {
    shared: path.join(process.cwd(), "supabase", "migrations"),
    local: path.join(process.cwd(), "db", "local-migrations"),
  });
  return db;
}

/**
 * Returns the process-wide embedded PostgreSQL instance.
 *
 * The provider is resolved by the caller. PGlite is a single-process runtime,
 * so the instance is cached on `globalThis` to survive Next.js development
 * hot reloads.
 */
export async function getLocalDatabase(): Promise<PGlite> {
  if (!globalForPglite.__atlasLocalDatabase) {
    const pending = createDatabase().catch((error: unknown) => {
      globalForPglite.__atlasLocalDatabase = undefined;
      throw error;
    });
    globalForPglite.__atlasLocalDatabase = pending;
  }
  return globalForPglite.__atlasLocalDatabase;
}

export async function closeLocalDatabase(): Promise<void> {
  const pending = globalForPglite.__atlasLocalDatabase;
  globalForPglite.__atlasLocalDatabase = undefined;
  if (!pending) return;

  try {
    const db = await pending;
    await db.close();
  } catch {
    // Initialization failures are already surfaced to the original caller.
  }
}
