create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema extensions to service_role;

create table if not exists public.documents (
  id uuid primary key,
  name text not null,
  mime_type text not null,
  chunk_count integer not null check (chunk_count > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.document_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  page integer,
  section text,
  content text not null,
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now()
);

create index if not exists document_chunks_embedding_idx
  on public.document_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

create index if not exists document_chunks_document_id_idx
  on public.document_chunks (document_id);

alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;

revoke all on public.documents, public.document_chunks from anon, authenticated;
grant all on public.documents, public.document_chunks to service_role;

create or replace function public.match_documents(
  query_embedding extensions.vector(1536),
  match_count integer default 5,
  match_threshold real default 0.25
)
returns table (
  id bigint,
  document_id uuid,
  doc_title text,
  page integer,
  section text,
  content text,
  similarity real
)
language sql
stable
set search_path = public, extensions
as $$
  select
    chunks.id,
    chunks.document_id,
    documents.name as doc_title,
    chunks.page,
    chunks.section,
    chunks.content,
    (1 - (chunks.embedding <=> query_embedding))::real as similarity
  from public.document_chunks as chunks
  join public.documents as documents on documents.id = chunks.document_id
  where 1 - (chunks.embedding <=> query_embedding) >= match_threshold
  order by chunks.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;

revoke all on function public.match_documents(extensions.vector, integer, real) from public, anon, authenticated;
grant execute on function public.match_documents(extensions.vector, integer, real) to service_role;
