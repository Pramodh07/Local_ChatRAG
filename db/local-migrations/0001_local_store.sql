-- Local-only storage used by the embedded PostgreSQL runtime.
--
-- The local runtime keeps validated auth and account documents in PostgreSQL
-- while the shared migrations provide the normalized conversation tables. This
-- migration is intentionally not part of `supabase/migrations`; hosted Supabase
-- has no use for local session or preference documents.

create schema if not exists local;

create table if not exists local.json_stores (
  name text primary key,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  updated_at timestamptz not null default now()
);

comment on table local.json_stores is
  'Validated application documents for the embedded local PostgreSQL runtime.';
