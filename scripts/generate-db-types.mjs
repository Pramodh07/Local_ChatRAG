import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const OUTPUT = join(
  ROOT,
  "src",
  "modules",
  "shared",
  "integrations",
  "database.generated.ts",
);

// The migrations are written for Supabase. Recreate only the contract they
// reference so the same SQL can be applied to plain PostgreSQL in PGlite.
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

function splitTopLevel(input) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const character of input) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function mapType(raw) {
  const type = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (type.startsWith("extensions.vector") || type.startsWith("vector")) return "number[]";
  if (type.endsWith("[]")) return `${mapType(type.slice(0, -2))}[]`;
  const base = type.replace(/\(\d+(?:,\s*\d+)?\)/g, "");
  if (
    ["uuid", "text", "character varying", "varchar", "char", "bpchar", "timestamptz", "timestamp with time zone", "timestamp", "date", "time"].includes(base)
  ) {
    return "string";
  }
  if (
    ["integer", "int", "int2", "int4", "int8", "bigint", "smallint", "real", "double precision", "numeric", "decimal"].includes(base)
  ) {
    return "number";
  }
  if (base === "boolean" || base === "bool") return "boolean";
  if (base === "json" || base === "jsonb") return "Json";
  return "unknown";
}

function parseArguments(raw) {
  if (!raw.trim()) return [];
  return splitTopLevel(raw).map((part) => {
    const withoutDefault = part.replace(/\s+default\s+[\s\S]+$/i, "").trim();
    const match = withoutDefault.match(/^"?([^"\s]+)"?\s+([\s\S]+)$/);
    if (!match) throw new Error(`Could not parse function argument: ${part}`);
    return {
      name: match[1],
      type: mapType(match[2]),
      optional: /\s+default\s+/i.test(part),
    };
  });
}

// PostgreSQL does not expose nullability for TABLE(...) return columns. These
// match the nullable source columns in the function body.
const NULLABLE_RETURN_COLUMNS = {
  match_documents: new Set(["page", "section"]),
};

function parseReturn(name, raw) {
  const table = raw.trim().match(/^table\s*\(([\s\S]+)\)$/i);
  if (!table) return { kind: "scalar", type: mapType(raw) };

  const seen = new Set();
  const columns = splitTopLevel(table[1]).map((part) => {
    const match = part.match(/^"?([^"\s]+)"?\s+([\s\S]+)$/);
    if (!match) throw new Error(`Could not parse function return column: ${part}`);
    if (seen.has(match[1])) {
      throw new Error(`Duplicate return column "${match[1]}" in function "${name}"`);
    }
    seen.add(match[1]);
    return {
      name: match[1],
      type: mapType(match[2]),
      nullable: NULLABLE_RETURN_COLUMNS[name]?.has(match[1]) ?? false,
    };
  });
  return { kind: "table", columns };
}

function renderRow(columns) {
  return columns
    .map((column) => `          ${column.name}: ${column.type}${column.nullable ? " | null" : ""};`)
    .join("\n");
}

function renderInsert(columns) {
  return columns
    .map((column) => {
      const optional = column.nullable || column.hasDefault;
      const type = `${column.type}${column.nullable ? " | null" : ""}`;
      return `          ${column.name}${optional ? "?" : ""}: ${type};`;
    })
    .join("\n");
}

function renderTypes({ tables, functions }) {
  const tableBlocks = tables
    .map(
      (table) => `      ${table.name}: {
        Row: {
${renderRow(table.columns)}
        };
        Insert: {
${renderInsert(table.columns)}
        };
        Update: Partial<Database["public"]["Tables"]["${table.name}"]["Insert"]>;
        Relationships: [];
      };`,
    )
    .join("\n");

  const functionBlocks = functions
    .map((fn) => {
      const args = fn.args.length
        ? fn.args
            .map((argument) => `          ${argument.name}${argument.optional ? "?" : ""}: ${argument.type};`)
            .join("\n")
        : "          [_ in never]: never";
      const returns =
        fn.returns.kind === "table"
          ? `{
${fn.returns.columns
  .map((column) => `            ${column.name}: ${column.type}${column.nullable ? " | null" : ""};`)
  .join("\n")}
          }[]`
          : fn.returns.type;
      return `      ${fn.name}: {
        Args: {
${args}
        };
        Returns: ${returns};
      };`;
    })
    .join("\n");

  return `// Generated by scripts/generate-db-types.mjs. Do not edit by hand.
// Regenerate with: pnpm db:types

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
${tableBlocks}
    };
    Views: Record<string, never>;
    Functions: {
${functionBlocks}
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type RetrievedChunk =
  Database["public"]["Functions"]["match_documents"]["Returns"][number];
`;
}

async function introspect(db) {
  const { rows: tableRows } = await db.query(
    `select c.relname as table_name,
            a.attname as column_name,
            format_type(a.atttypid, a.atttypmod) as data_type,
            not a.attnotnull as is_nullable,
            (a.atthasdef or a.attidentity <> '' or a.attgenerated <> '') as has_default
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public'
       and c.relkind = 'r'
       and a.attnum > 0
       and not a.attisdropped
     order by c.relname, a.attnum`,
  );

  const tables = new Map();
  for (const row of tableRows) {
    const table = tables.get(row.table_name) ?? { name: row.table_name, columns: [] };
    table.columns.push({
      name: row.column_name,
      type: mapType(row.data_type),
      nullable: row.is_nullable,
      hasDefault: row.has_default,
    });
    tables.set(row.table_name, table);
  }

  // Include functions callable by either the browser client or the service-role
  // worker. Filtering on `authenticated` alone would silently drop worker RPCs
  // as soon as their execute grant is tightened (see migration 0010).
  const { rows: functionRows } = await db.query(
    `select p.proname as name,
            pg_get_function_arguments(p.oid) as arguments,
            pg_get_function_result(p.oid) as result
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and (
         has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('service_role', p.oid, 'execute')
       )
     order by p.proname`,
  );

  const functions = functionRows
    .filter((row) => !/^trigger$/i.test(row.result))
    .map((row) => ({
      name: row.name,
      args: parseArguments(row.arguments),
      returns: parseReturn(row.name, row.result),
    }));

  return { tables: [...tables.values()], functions };
}

async function main() {
  const db = new PGlite({ extensions: { vector } });
  await db.waitReady;
  await db.exec(SUPABASE_STUBS);

  for (const name of readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
  }

  const schema = await introspect(db);
  await db.close();

  const generated = renderTypes(schema);

  if (process.argv.includes("--check")) {
    const current = readFileSync(OUTPUT, "utf8");
    if (current !== generated) {
      console.error(
        "Database types are stale. Run `pnpm db:types` and commit the regenerated file.",
      );
      process.exitCode = 1;
      return;
    }
    console.log("Database types are up to date.");
    return;
  }

  writeFileSync(OUTPUT, generated, "utf8");
  console.log(`Wrote ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
