import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { applyLocalMigrations } from "@/modules/shared/integrations/pglite-bootstrap";

export const WEB_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export const MIGRATION_DIRECTORIES = {
  shared: path.join(WEB_ROOT, "supabase", "migrations"),
  local: path.join(WEB_ROOT, "db", "local-migrations"),
};

export async function createTestLocalDatabase(): Promise<PGlite> {
  const db = new PGlite({ dataDir: "memory://", extensions: { vector } });
  await db.waitReady;
  await applyLocalMigrations(db, MIGRATION_DIRECTORIES);
  return db;
}
