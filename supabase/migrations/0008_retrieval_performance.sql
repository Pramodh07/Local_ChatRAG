-- Performance optimization for vector retrieval and document owner lookups.
--
-- 1. Evaluates (select auth.uid()) as a single scalar query instead of calling
--    auth.uid() per row in match_documents.
-- 2. Adds a composite index on public.documents (owner_id, status) to accelerate
--    the owner filter and 'ready' check in match_documents joins.

create index if not exists documents_owner_status_idx
  on public.documents (owner_id, status);

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
  where documents.owner_id = (select auth.uid())
    and documents.status = 'ready'
    and 1 - (chunks.embedding <=> query_embedding) >= match_threshold
  order by chunks.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;

revoke all on function public.match_documents(extensions.vector, integer, real)
  from public, anon, service_role;
grant execute on function public.match_documents(extensions.vector, integer, real)
  to authenticated;
