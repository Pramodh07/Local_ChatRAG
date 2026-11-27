#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SHARED_MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const LOCAL_MIGRATIONS = path.join(ROOT, "db", "local-migrations");
const DEFAULT_SOURCE = path.join(ROOT, ".local-data");
const DEFAULT_DATA_DIR =
  process.env.PGLITE_DATA_DIR?.trim() || path.join(ROOT, ".local-data", "pglite");

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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONVERSATIONS = 500;
const MAX_MESSAGES_PER_CONVERSATION = 2_000;
const MAX_MESSAGE_LENGTH = 100_000;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isString(value, max = Number.POSITIVE_INFINITY) {
  return typeof value === "string" && value.length <= max;
}

function isFiniteNumber(value, minimum = Number.NEGATIVE_INFINITY) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateAuthStore(value) {
  assert(value.version === 1, "auth-store.json has an unsupported version.");
  assert(Array.isArray(value.users), "auth-store.json users must be an array.");
  assert(Array.isArray(value.sessions), "auth-store.json sessions must be an array.");

  const userIds = new Set();
  for (const [index, user] of value.users.entries()) {
    const label = `auth-store.json users[${index}]`;
    assert(isRecord(user), `${label} must be an object.`);
    assert(isUuid(user.id), `${label} has an invalid id.`);
    assert(!userIds.has(user.id), `${label} duplicates another user id.`);
    assert(isString(user.email, 254), `${label} has an invalid email.`);
    assert(isString(user.displayName, 100), `${label} has an invalid displayName.`);
    assert(
      user.avatarUrl === undefined || user.avatarUrl === null || isString(user.avatarUrl),
      `${label} has an invalid avatarUrl.`,
    );
    assert(isString(user.passwordSalt), `${label} has an invalid passwordSalt.`);
    assert(isString(user.passwordHash), `${label} has an invalid passwordHash.`);
    assert(isString(user.createdAt), `${label} has an invalid createdAt.`);
    userIds.add(user.id);
  }

  for (const [index, session] of value.sessions.entries()) {
    const label = `auth-store.json sessions[${index}]`;
    assert(isRecord(session), `${label} must be an object.`);
    assert(isString(session.id), `${label} has an invalid id.`);
    assert(isString(session.tokenHash), `${label} has an invalid tokenHash.`);
    assert(isUuid(session.userId), `${label} has an invalid userId.`);
    assert(isString(session.expiresAt), `${label} has an invalid expiresAt.`);
  }
}

function validateAccountStore(value) {
  assert(value.version === 1, "account-store.json has an unsupported version.");
  assert(isRecord(value.accounts), "account-store.json accounts must be an object.");

  for (const [accountId, account] of Object.entries(value.accounts)) {
    const label = `account-store.json accounts["${accountId}"]`;
    assert(isRecord(account), `${label} must be an object.`);
    assert(isRecord(account.preferences), `${label}.preferences must be an object.`);
    assert(isString(account.preferences.provider), `${label}.preferences.provider is invalid.`);
    assert(isString(account.preferences.model), `${label}.preferences.model is invalid.`);
    assert(isString(account.preferences.theme), `${label}.preferences.theme is invalid.`);
    assert(Array.isArray(account.usage), `${label}.usage must be an array.`);
    for (const [index, bucket] of account.usage.entries()) {
      const bucketLabel = `${label}.usage[${index}]`;
      assert(isRecord(bucket), `${bucketLabel} must be an object.`);
      assert(isString(bucket.date), `${bucketLabel}.date is invalid.`);
      assert(isString(bucket.provider), `${bucketLabel}.provider is invalid.`);
      assert(isString(bucket.model), `${bucketLabel}.model is invalid.`);
      assert(
        Number.isSafeInteger(bucket.requests),
        `${bucketLabel}.requests is invalid.`,
      );
      assert(
        Number.isSafeInteger(bucket.inputTokens),
        `${bucketLabel}.inputTokens is invalid.`,
      );
      assert(
        Number.isSafeInteger(bucket.outputTokens),
        `${bucketLabel}.outputTokens is invalid.`,
      );
      assert(
        isFiniteNumber(bucket.estimatedCostUsd, 0),
        `${bucketLabel}.estimatedCostUsd is invalid.`,
      );
      assert(
        typeof bucket.costEstimateComplete === "boolean",
        `${bucketLabel}.costEstimateComplete is invalid.`,
      );
    }
  }
}

function validateConversation(conversation, label) {
  assert(isRecord(conversation), `${label} must be an object.`);
  assert(isUuid(conversation.id), `${label}.id must be a UUID.`);
  assert(isString(conversation.title, 200), `${label}.title is invalid.`);
  assert(conversation.title.length > 0, `${label}.title is empty.`);
  assert(Array.isArray(conversation.messages), `${label}.messages must be an array.`);
  assert(
    conversation.messages.length <= MAX_MESSAGES_PER_CONVERSATION,
    `${label} has too many messages.`,
  );
  assert(isFiniteNumber(conversation.updatedAt, 0), `${label}.updatedAt is invalid.`);
  assert(
    conversation.archivedAt === undefined || isFiniteNumber(conversation.archivedAt, 0),
    `${label}.archivedAt is invalid.`,
  );

  for (const [index, message] of conversation.messages.entries()) {
    const messageLabel = `${label}.messages[${index}]`;
    assert(isRecord(message), `${messageLabel} must be an object.`);
    assert(isUuid(message.id), `${messageLabel}.id must be a UUID.`);
    assert(
      message.role === "user" || message.role === "assistant",
      `${messageLabel}.role is invalid.`,
    );
    assert(isString(message.content, MAX_MESSAGE_LENGTH), `${messageLabel}.content is invalid.`);
    assert(
      message.status === "streaming" ||
        message.status === "done" ||
        message.status === "stopped" ||
        message.status === "error",
      `${messageLabel}.status is invalid.`,
    );
    assert(
      message.stage === undefined || message.stage === "retrieving" || message.stage === "done",
      `${messageLabel}.stage is invalid.`,
    );
    assert(
      message.citations === undefined || Array.isArray(message.citations),
      `${messageLabel}.citations is invalid.`,
    );
    assert(
      message.tokens === undefined || isFiniteNumber(message.tokens, 0),
      `${messageLabel}.tokens is invalid.`,
    );
    assert(isFiniteNumber(message.createdAt, 0), `${messageLabel}.createdAt is invalid.`);
  }
}

function validateConversationStore(value) {
  assert(value.version === 1, "conversation-store.json has an unsupported version.");
  assert(
    Array.isArray(value.conversations),
    "conversation-store.json conversations must be an array.",
  );
  assert(
    value.conversations.length <= MAX_CONVERSATIONS,
    "conversation-store.json has too many conversations.",
  );

  const conversationIds = new Set();
  const messageIds = new Set();
  for (const [index, entry] of value.conversations.entries()) {
    const label = `conversation-store.json conversations[${index}]`;
    assert(isRecord(entry), `${label} must be an object.`);
    assert(isUuid(entry.ownerId), `${label}.ownerId must be a UUID.`);
    validateConversation(entry.conversation, `${label}.conversation`);
    assert(
      !conversationIds.has(entry.conversation.id),
      `${label} duplicates a conversation id.`,
    );
    conversationIds.add(entry.conversation.id);
    for (const message of entry.conversation.messages) {
      assert(!messageIds.has(message.id), `${label} duplicates message id ${message.id}.`);
      messageIds.add(message.id);
    }
  }
}

async function readOptionalJson(sourceDir, fileName) {
  const filePath = path.join(sourceDir, fileName);
  if (!existsSync(filePath)) return { fileName, value: null };
  const contents = await readFile(filePath, "utf8");
  let value;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error(`${fileName} is not valid JSON.`, { cause: error });
  }
  return { fileName, value };
}

async function loadSource(sourceDir) {
  const auth = await readOptionalJson(sourceDir, "auth-store.json");
  const account = await readOptionalJson(sourceDir, "account-store.json");
  const conversations = await readOptionalJson(sourceDir, "conversation-store.json");

  if (auth.value !== null) validateAuthStore(auth.value);
  if (account.value !== null) validateAccountStore(account.value);
  if (conversations.value !== null) validateConversationStore(conversations.value);

  return { auth, account, conversations };
}

async function applyMigrations(db) {
  await db.exec(SUPABASE_STUBS);
  await db.exec(`
    create schema if not exists local;
    create table if not exists local.schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    );
  `);

  const migrations = [];
  for (const [label, directory] of [
    ["shared", SHARED_MIGRATIONS],
    ["local", LOCAL_MIGRATIONS],
  ]) {
    const names = (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of names) {
      const migrationPath = path.join(directory, name);
      const sql = await readFile(migrationPath, "utf8");
      migrations.push({
        name: `${label}/${name}`,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      });
    }
  }

  let applied = 0;
  for (const migration of migrations) {
    const existing = await db.query(
      "select checksum from local.schema_migrations where name = $1",
      [migration.name],
    );
    if (existing.rows.length > 0) {
      if (existing.rows[0].checksum !== migration.checksum) {
        throw new Error(
          `Migration ${migration.name} changed after it was applied. Add a new migration instead.`,
        );
      }
      continue;
    }

    await db.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query(
        "insert into local.schema_migrations (name, checksum) values ($1, $2)",
        [migration.name, migration.checksum],
      );
    });
    applied += 1;
  }
  return { applied, total: migrations.length };
}

async function assertTargetIsEmpty(db, jsonStoreNames, ownerIds) {
  const stores = await db.query(
    `select name from local.json_stores where name = any($1::text[])`,
    [jsonStoreNames],
  );
  if (stores.rows.length > 0) {
    throw new Error(
      `The target already contains ${stores.rows.map((row) => row.name).join(", ")}. ` +
        "Re-run with --force to replace imported records.",
    );
  }

  for (const ownerId of ownerIds) {
    const result = await db.query(
      "select count(*)::integer as count from public.conversations where owner_id = $1",
      [ownerId],
    );
    if (result.rows[0].count > 0) {
      throw new Error(
        `The target already has conversations for ${ownerId}. Re-run with --force to replace them.`,
      );
    }
  }
}

export async function importLocalData({
  sourceDir = DEFAULT_SOURCE,
  dataDir = DEFAULT_DATA_DIR,
  force = false,
  dryRun = false,
  logger = console,
} = {}) {
  const source = await loadSource(sourceDir);
  const authStore = source.auth.value;
  const accountStore = source.account.value;
  const conversationStore = source.conversations.value;
  const entries = conversationStore?.conversations ?? [];
  const owners = [...new Set(entries.map((entry) => entry.ownerId))];
  const jsonStoreNames = [
    source.auth.value !== null ? "auth-store.json" : null,
    source.account.value !== null ? "account-store.json" : null,
  ].filter(Boolean);
  const messageCount = entries.reduce(
    (total, entry) => total + entry.conversation.messages.length,
    0,
  );

  const plan = {
    users: authStore?.users.length ?? 0,
    sessions: authStore?.sessions.length ?? 0,
    accounts: accountStore ? Object.keys(accountStore.accounts).length : 0,
    conversations: entries.length,
    messages: messageCount,
    owners: owners.length,
  };

  if (dryRun) {
    logger.log("Dry run: no database changes were made.");
    logger.log(JSON.stringify(plan, null, 2));
    return plan;
  }

  if (!dataDir.startsWith("memory://") && !dataDir.startsWith("idb://")) {
    await mkdir(path.dirname(dataDir), { recursive: true, mode: 0o700 });
  }

  const db = new PGlite({ dataDir, extensions: { vector } });
  try {
    await db.waitReady;
    const migrationState = await applyMigrations(db);
    logger.log(
      `Applied ${migrationState.applied} migration(s); ${migrationState.total} total.`,
    );

    await db.transaction(async (tx) => {
      if (!force) await assertTargetIsEmpty(tx, jsonStoreNames, owners);

      if (authStore) {
        for (const user of authStore.users) {
          await tx.query(
            `insert into auth.users (id, email, raw_user_meta_data)
             values ($1, $2, $3::jsonb)
             on conflict (id) do update
             set email = excluded.email,
                 raw_user_meta_data = excluded.raw_user_meta_data`,
            [user.id, user.email, JSON.stringify({ display_name: user.displayName })],
          );
        }
      }

      for (const ownerId of owners) {
        await tx.query(
          `insert into auth.users (id, email, raw_user_meta_data)
           values ($1, null, '{}'::jsonb)
           on conflict (id) do nothing`,
          [ownerId],
        );
      }

      if (force) {
        for (const ownerId of owners) {
          await tx.query("delete from public.messages where owner_id = $1", [ownerId]);
          await tx.query("delete from public.conversations where owner_id = $1", [ownerId]);
        }
      }

      if (authStore) {
        await tx.query(
          `insert into local.json_stores (name, content)
           values ('auth-store.json', $1::jsonb)
           on conflict (name) do update
           set content = excluded.content, updated_at = now()`,
          [JSON.stringify(authStore)],
        );
      }
      if (accountStore) {
        await tx.query(
          `insert into local.json_stores (name, content)
           values ('account-store.json', $1::jsonb)
           on conflict (name) do update
           set content = excluded.content, updated_at = now()`,
          [JSON.stringify(accountStore)],
        );
      }

      for (const entry of entries) {
        const conversation = entry.conversation;
        await tx.query(
          `insert into public.conversations
             (id, owner_id, title, archived_at_ms, updated_at_ms)
           values ($1, $2, $3, $4, $5)`,
          [
            conversation.id,
            entry.ownerId,
            conversation.title,
            conversation.archivedAt ?? null,
            conversation.updatedAt,
          ],
        );

        for (const [sequence, message] of conversation.messages.entries()) {
          await tx.query(
            `insert into public.messages
               (id, conversation_id, owner_id, role, content, status, stage,
                citations, tokens, sequence, created_at_ms)
             values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
            [
              message.id,
              conversation.id,
              entry.ownerId,
              message.role,
              message.content,
              message.status,
              message.stage ?? null,
              message.citations === undefined ? null : JSON.stringify(message.citations),
              message.tokens ?? null,
              sequence,
              message.createdAt,
            ],
          );
        }
      }
    });
  } finally {
    await db.close();
  }

  logger.log(`Imported from ${sourceDir} into ${dataDir}.`);
  logger.log(JSON.stringify(plan, null, 2));
  return plan;
}

function parseArgs(argv) {
  const options = { force: false, dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--force") options.force = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--source" || argument === "--data-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a path.`);
      if (argument === "--source") options.sourceDir = path.resolve(value);
      else options.dataDir = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: pnpm local:import [options]

Copies validated .local-data JSON records into the embedded PostgreSQL runtime.
The source JSON files are never modified.

Options:
  --source <dir>     Source directory (default: .local-data)
  --data-dir <dir>   PGlite data directory (default: .local-data/pglite)
  --force            Replace records that already exist in the target
  --dry-run          Validate and report counts without opening the database
  -h, --help         Show this help

Set DATABASE_PROVIDER=postgres in .env.local after importing to use the data.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  await importLocalData(options);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
