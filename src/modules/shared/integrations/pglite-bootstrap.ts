import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";

/**
 * Minimal Supabase-compatible objects required by the shared migrations.
 *
 * Hosted Supabase provides `auth.users`, `auth.uid()`, and the `anon`,
 * `authenticated`, and `service_role` roles. PGlite is plain PostgreSQL, so the
 * local runtime recreates just enough of that contract to apply the same SQL.
 */
export const SUPABASE_STUBS = `
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

const MIGRATION_TABLE = "local.schema_migrations";

const CREATE_MIGRATION_TABLE = `
create schema if not exists local;

create table if not exists local.schema_migrations (
  name text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);
`;

export type MigrationDirectories = {
  shared: string;
  local: string;
};

export type MigrationResult = {
  applied: string[];
  skipped: string[];
};

type Migration = {
  name: string;
  path: string;
  checksum: string;
};

function migrationFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function collectMigrations(
  label: string,
  directory: string,
  target: Migration[],
): void {
  for (const name of migrationFiles(directory)) {
    const path = join(directory, name);
    const sql = readFileSync(path, "utf8");
    target.push({
      name: `${label}/${name}`,
      path,
      checksum: createHash("sha256").update(sql).digest("hex"),
    });
  }
}

/**
 * Applies shared Supabase migrations and local-only migrations exactly once.
 *
 * `local.schema_migrations` records the checksum of every applied file. A
 * changed checksum fails fast instead of running an edited migration on top of
 * an existing database.
 */
export async function applyLocalMigrations(
  db: PGlite,
  directories: MigrationDirectories,
): Promise<MigrationResult> {
  await db.exec(SUPABASE_STUBS);
  await db.exec(CREATE_MIGRATION_TABLE);

  const migrations: Migration[] = [];
  collectMigrations("shared", directories.shared, migrations);
  collectMigrations("local", directories.local, migrations);

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    const existing = await db.query<{ checksum: string }>(
      `select checksum from ${MIGRATION_TABLE} where name = $1`,
      [migration.name],
    );
    if (existing.rows.length > 0) {
      if (existing.rows[0].checksum !== migration.checksum) {
        throw new Error(
          `Migration ${migration.name} changed after it was applied. Add a new migration instead.`,
        );
      }
      skipped.push(migration.name);
      continue;
    }

    const sql = readFileSync(migration.path, "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query(
        `insert into ${MIGRATION_TABLE} (name, checksum) values ($1, $2)`,
        [migration.name, migration.checksum],
      );
    });
    applied.push(migration.name);
  }

  return { applied, skipped };
}
