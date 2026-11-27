-- Phase 3: durable, asynchronous document ingestion.
--
-- Uploads are stored privately and enqueued in one transaction. A worker claims
-- jobs with FOR UPDATE SKIP LOCKED, retries failures with backoff, and only
-- marks a document ready after every chunk has been written. Documents that are
-- queued, processing, or failed are excluded from retrieval, so a partial write
-- can never be cited.
--
-- All functions are SECURITY INVOKER so the caller's RLS policies remain in
-- force, and EXECUTE is limited to the authenticated role. The application
-- worker drains the signed-in owner's queue; a future service_role worker must
-- be granted EXECUTE explicitly during deployment.

-- ---------------------------------------------------------------------------
-- Documents: lifecycle state and a run counter
-- ---------------------------------------------------------------------------

alter table public.documents
  add column if not exists status text not null default 'ready'
    check (status in ('queued', 'processing', 'ready', 'failed')),
  add column if not exists current_version_id uuid,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.documents
  drop constraint if exists documents_chunk_count_check;
alter table public.documents
  add constraint documents_chunk_count_check check (chunk_count >= 0);

-- ---------------------------------------------------------------------------
-- Document versions: immutable source metadata, checksums, storage keys
-- ---------------------------------------------------------------------------

create table if not exists public.document_versions (
  id uuid primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check (version > 0),
  storage_key text not null check (char_length(storage_key) between 1 and 500),
  original_name text not null check (char_length(original_name) between 1 and 200),
  mime_type text not null check (char_length(mime_type) between 1 and 100),
  size_bytes bigint not null check (size_bytes > 0),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'ready', 'failed')),
  page_count integer check (page_count is null or page_count > 0),
  chunk_count integer not null default 0 check (chunk_count >= 0),
  embedding_model text,
  chunk_size integer not null default 1200 check (chunk_size between 200 and 8000),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, version)
);

create unique index if not exists document_versions_owner_checksum_key
  on public.document_versions (owner_id, checksum_sha256);

create index if not exists document_versions_document_idx
  on public.document_versions (document_id);

alter table public.documents
  drop constraint if exists documents_current_version_fk;
alter table public.documents
  add constraint documents_current_version_fk
  foreign key (current_version_id) references public.document_versions(id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- Ingestion jobs: durable queue with bounded retries
-- ---------------------------------------------------------------------------

create table if not exists public.ingestion_jobs (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  version_id uuid not null references public.document_versions(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'succeeded', 'failed')),
  stage text not null default 'queued'
    check (stage in ('queued', 'extracting', 'chunking', 'embedding', 'storing', 'done')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (version_id)
);

create index if not exists ingestion_jobs_due_idx
  on public.ingestion_jobs (available_at)
  where status in ('queued', 'processing');

create index if not exists ingestion_jobs_owner_created_idx
  on public.ingestion_jobs (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Chunks: version identity, stable order, and dedupe
-- ---------------------------------------------------------------------------

alter table public.document_chunks
  add column if not exists version_id uuid references public.document_versions(id) on delete cascade,
  add column if not exists chunk_index integer,
  add column if not exists content_hash text,
  add column if not exists embedding_model text;

create unique index if not exists document_chunks_version_index_key
  on public.document_chunks (version_id, chunk_index)
  where version_id is not null;

create index if not exists document_chunks_version_idx
  on public.document_chunks (version_id);

-- ---------------------------------------------------------------------------
-- Storage cleanup queue: object deletion survives a failed delete call
-- ---------------------------------------------------------------------------

create table if not exists public.storage_cleanup_queue (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_key text not null unique,
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists storage_cleanup_queue_due_idx
  on public.storage_cleanup_queue (available_at);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.document_versions enable row level security;
alter table public.ingestion_jobs enable row level security;
alter table public.storage_cleanup_queue enable row level security;

revoke all on public.document_versions, public.ingestion_jobs, public.storage_cleanup_queue
  from anon, authenticated;
grant select, insert, update, delete
  on public.document_versions, public.ingestion_jobs, public.storage_cleanup_queue
  to authenticated;
grant usage, select on sequence public.storage_cleanup_queue_id_seq to authenticated;

-- Workers may advance document lifecycle state, but cannot rename a document or
-- reassign its owner through a normal table update.
grant update (status, chunk_count, current_version_id, last_error, updated_at)
  on public.documents to authenticated;

drop policy if exists "Users can access their document versions" on public.document_versions;
create policy "Users can access their document versions"
  on public.document_versions for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Users can access their ingestion jobs" on public.ingestion_jobs;
create policy "Users can access their ingestion jobs"
  on public.ingestion_jobs for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Users can access their storage cleanup queue" on public.storage_cleanup_queue;
create policy "Users can access their storage cleanup queue"
  on public.storage_cleanup_queue for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Retrieval: only fully indexed documents are searchable
-- ---------------------------------------------------------------------------

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
  where documents.owner_id = auth.uid()
    and documents.status = 'ready'
    and 1 - (chunks.embedding <=> query_embedding) >= match_threshold
  order by chunks.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;

revoke all on function public.match_documents(extensions.vector, integer, real)
  from public, anon, service_role;
grant execute on function public.match_documents(extensions.vector, integer, real)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Enqueue: document + version + job in one transaction
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_document_ingestion(
  p_document_id uuid,
  p_version_id uuid,
  p_job_id uuid,
  p_name text,
  p_mime_type text,
  p_storage_key text,
  p_size_bytes bigint,
  p_checksum text,
  p_chunk_size integer
)
returns table (
  document_id uuid,
  version_id uuid,
  job_id uuid,
  status text,
  duplicate boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_name text := left(trim(coalesce(p_name, '')), 200);
  v_mime text := left(trim(coalesce(p_mime_type, '')), 100);
  v_existing record;
begin
  if v_owner is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_document_id is null or p_version_id is null or p_job_id is null then
    raise exception 'Document, version, and job identifiers are required.'
      using errcode = '22023';
  end if;
  if v_name = '' then
    v_name := 'Untitled document';
  end if;
  if v_mime = '' then
    v_mime := 'application/octet-stream';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 then
    raise exception 'Document size must be positive.' using errcode = '22023';
  end if;
  if p_storage_key is null or char_length(p_storage_key) not between 1 and 500 then
    raise exception 'A valid storage key is required.' using errcode = '22023';
  end if;
  if p_checksum is null or p_checksum !~ '^[0-9a-f]{64}$' then
    raise exception 'A SHA-256 checksum is required.' using errcode = '22023';
  end if;
  if p_chunk_size is null or p_chunk_size not between 200 and 8000 then
    raise exception 'Chunk size must be between 200 and 8000 characters.'
      using errcode = '22023';
  end if;

  select versions.id, versions.document_id, versions.status as version_status,
         jobs.id as job_id, jobs.status as job_status
    into v_existing
  from public.document_versions versions
  left join lateral (
    select latest_job.id, latest_job.status
    from public.ingestion_jobs latest_job
    where latest_job.version_id = versions.id
    order by latest_job.created_at desc
    limit 1
  ) jobs on true
  where versions.owner_id = v_owner
    and versions.checksum_sha256 = p_checksum
  limit 1;

  if found then
    if v_existing.version_status = 'failed' or v_existing.job_status = 'failed' then
      update public.documents
        set status = 'queued', last_error = null, updated_at = now()
        where id = v_existing.document_id and owner_id = v_owner;
      update public.document_versions
        set status = 'queued', last_error = null, updated_at = now()
        where id = v_existing.id and owner_id = v_owner;
      update public.ingestion_jobs
        set status = 'queued', stage = 'queued', attempts = 0, available_at = now(),
            locked_at = null, locked_by = null, last_error = null,
            completed_at = null, updated_at = now()
        where id = v_existing.job_id and owner_id = v_owner;
      return query
        select v_existing.document_id, v_existing.id, v_existing.job_id, 'queued'::text, false;
      return;
    end if;

    return query
      select v_existing.document_id, v_existing.id, v_existing.job_id,
             v_existing.job_status, true;
    return;
  end if;

  begin
    insert into public.documents
      (id, owner_id, name, mime_type, chunk_count, status)
    values
      (p_document_id, v_owner, v_name, v_mime, 0, 'queued');

    insert into public.document_versions
      (id, document_id, owner_id, version, storage_key, original_name, mime_type,
       size_bytes, checksum_sha256, status, chunk_size)
    values
      (p_version_id, p_document_id, v_owner, 1, p_storage_key, v_name, v_mime,
       p_size_bytes, p_checksum, 'queued', p_chunk_size);

    insert into public.ingestion_jobs
      (id, owner_id, document_id, version_id, status, stage, max_attempts)
    values
      (p_job_id, v_owner, p_document_id, p_version_id, 'queued', 'queued', 3);

    update public.documents
      set current_version_id = p_version_id
      where id = p_document_id and owner_id = v_owner;
  exception when unique_violation then
    select versions.id, versions.document_id, versions.status as version_status,
           jobs.id as job_id, jobs.status as job_status
      into v_existing
    from public.document_versions versions
    left join lateral (
      select latest_job.id, latest_job.status
      from public.ingestion_jobs latest_job
      where latest_job.version_id = versions.id
      order by latest_job.created_at desc
      limit 1
    ) jobs on true
    where versions.owner_id = v_owner
      and versions.checksum_sha256 = p_checksum
    limit 1;

    if v_existing.id is null then
      raise;
    end if;

    return query
      select v_existing.document_id, v_existing.id, v_existing.job_id,
             coalesce(v_existing.job_status, v_existing.version_status), true;
    return;
  end;

  return query
    select p_document_id, p_version_id, p_job_id, 'queued'::text, false;
end;
$$;

revoke all on function public.enqueue_document_ingestion(
  uuid, uuid, uuid, text, text, text, bigint, text, integer
) from public, anon, service_role;
grant execute on function public.enqueue_document_ingestion(
  uuid, uuid, uuid, text, text, text, bigint, text, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- Claim: FIFO due jobs, stale-lock recovery, SKIP LOCKED
-- ---------------------------------------------------------------------------

create or replace function public.claim_ingestion_jobs(
  p_worker_id text,
  p_limit integer
)
returns table (
  job_id uuid,
  owner_id uuid,
  document_id uuid,
  version_id uuid,
  attempts integer,
  max_attempts integer,
  storage_key text,
  original_name text,
  mime_type text,
  chunk_size integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_worker text := left(coalesce(nullif(trim(p_worker_id), ''), 'worker'), 100);
  v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 5);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  return query
  with due as (
    select jobs.id
    from public.ingestion_jobs jobs
    where (jobs.status = 'queued' and jobs.available_at <= now())
       or (jobs.status = 'processing'
           and jobs.locked_at < now() - interval '10 minutes')
    order by jobs.available_at
    limit v_limit
    for update skip locked
  ), claimed as (
    update public.ingestion_jobs jobs
      set status = 'processing',
          attempts = jobs.attempts + 1,
          locked_at = now(),
          locked_by = v_worker,
          updated_at = now()
      from due
      where jobs.id = due.id
      returning jobs.*
  ), document_updates as (
    update public.documents documents
      set status = 'processing', updated_at = now()
      from claimed
      where documents.id = claimed.document_id
      returning documents.id
  ), version_updates as (
    update public.document_versions versions
      set status = 'processing', updated_at = now()
      from claimed
      where versions.id = claimed.version_id
      returning versions.id
  )
  select claimed.id, claimed.owner_id, claimed.document_id, claimed.version_id,
         claimed.attempts, claimed.max_attempts,
         versions.storage_key, versions.original_name, versions.mime_type,
         versions.chunk_size
  from claimed
  join public.document_versions versions on versions.id = claimed.version_id;
end;
$$;

revoke all on function public.claim_ingestion_jobs(text, integer)
  from public, anon, service_role;
grant execute on function public.claim_ingestion_jobs(text, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Attempt lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.begin_ingestion_attempt(p_job_id uuid)
returns table (
  document_id uuid,
  version_id uuid,
  storage_key text,
  original_name text,
  mime_type text,
  chunk_size integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_job record;
begin
  if v_owner is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select jobs.document_id, jobs.version_id
    into v_job
  from public.ingestion_jobs jobs
  where jobs.id = p_job_id
    and jobs.owner_id = v_owner
    and jobs.status = 'processing'
  for update;

  if not found then
    raise exception 'Ingestion job is not available for processing.'
      using errcode = 'P0002';
  end if;

  -- A retried attempt starts from a clean chunk set. Because the document is
  -- still not ready, partial chunks are never retrievable.
  delete from public.document_chunks as chunks
  where chunks.version_id = v_job.version_id;

  update public.ingestion_jobs
    set stage = 'extracting', updated_at = now()
    where id = p_job_id;

  return query
    select v_job.document_id, v_job.version_id, versions.storage_key,
           versions.original_name, versions.mime_type, versions.chunk_size
    from public.document_versions versions
    where versions.id = v_job.version_id;
end;
$$;

revoke all on function public.begin_ingestion_attempt(uuid)
  from public, anon, service_role;
grant execute on function public.begin_ingestion_attempt(uuid)
  to authenticated;

create or replace function public.complete_ingestion_job(
  p_job_id uuid,
  p_chunk_count integer,
  p_page_count integer,
  p_embedding_model text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_job record;
begin
  if v_owner is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_chunk_count is null or p_chunk_count <= 0 then
    raise exception 'An ingestion job must produce at least one chunk.'
      using errcode = '22023';
  end if;
  if p_page_count is null or p_page_count <= 0 then
    raise exception 'Page count must be positive.' using errcode = '22023';
  end if;

  select jobs.document_id, jobs.version_id
    into v_job
  from public.ingestion_jobs jobs
  where jobs.id = p_job_id
    and jobs.owner_id = v_owner
    and jobs.status = 'processing'
  for update;

  if not found then
    raise exception 'Ingestion job is not available for completion.'
      using errcode = 'P0002';
  end if;

  update public.ingestion_jobs
    set status = 'succeeded', stage = 'done', locked_at = null, locked_by = null,
        last_error = null, completed_at = now(), updated_at = now()
    where id = p_job_id;

  update public.document_versions
    set status = 'ready', chunk_count = p_chunk_count, page_count = p_page_count,
        embedding_model = left(coalesce(p_embedding_model, ''), 100),
        last_error = null, updated_at = now()
    where id = v_job.version_id;

  update public.documents
    set status = 'ready', chunk_count = p_chunk_count,
        current_version_id = v_job.version_id, last_error = null, updated_at = now()
    where id = v_job.document_id;
end;
$$;

revoke all on function public.complete_ingestion_job(uuid, integer, integer, text)
  from public, anon, service_role;
grant execute on function public.complete_ingestion_job(uuid, integer, integer, text)
  to authenticated;

create or replace function public.fail_ingestion_job(
  p_job_id uuid,
  p_error text,
  p_retryable boolean
)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_job record;
  v_message text := left(coalesce(nullif(trim(p_error), ''), 'Ingestion failed.'), 1000);
  v_status text;
begin
  if v_owner is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select jobs.document_id, jobs.version_id, jobs.attempts, jobs.max_attempts
    into v_job
  from public.ingestion_jobs jobs
  where jobs.id = p_job_id
    and jobs.owner_id = v_owner
    and jobs.status = 'processing'
  for update;

  if not found then
    raise exception 'Ingestion job is not available for failure handling.'
      using errcode = 'P0002';
  end if;

  if coalesce(p_retryable, false) and v_job.attempts < v_job.max_attempts then
    update public.ingestion_jobs
      set status = 'queued', stage = 'queued',
          available_at = now() + make_interval(
            secs => least(300, 15 * power(2, v_job.attempts))
          ),
          locked_at = null, locked_by = null, last_error = v_message,
          completed_at = null, updated_at = now()
      where id = p_job_id;

    update public.document_versions
      set status = 'queued', last_error = v_message, updated_at = now()
      where id = v_job.version_id;

    update public.documents
      set status = 'queued', last_error = v_message, updated_at = now()
      where id = v_job.document_id;

    v_status := 'queued';
  else
    update public.ingestion_jobs
      set status = 'failed', locked_at = null, locked_by = null,
          last_error = v_message, completed_at = now(), updated_at = now()
      where id = p_job_id;

    update public.document_versions
      set status = 'failed', last_error = v_message, updated_at = now()
      where id = v_job.version_id;

    update public.documents
      set status = 'failed', last_error = v_message, updated_at = now()
      where id = v_job.document_id;

    v_status := 'failed';
  end if;

  return v_status;
end;
$$;

revoke all on function public.fail_ingestion_job(uuid, text, boolean)
  from public, anon, service_role;
grant execute on function public.fail_ingestion_job(uuid, text, boolean)
  to authenticated;

create or replace function public.retry_ingestion_job(p_job_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_job record;
begin
  if v_owner is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select jobs.document_id, jobs.version_id
    into v_job
  from public.ingestion_jobs jobs
  where jobs.id = p_job_id
    and jobs.owner_id = v_owner
    and jobs.status = 'failed'
  for update;

  if not found then
    return false;
  end if;

  update public.ingestion_jobs
    set status = 'queued', stage = 'queued', attempts = 0, available_at = now(),
        locked_at = null, locked_by = null, last_error = null,
        completed_at = null, updated_at = now()
    where id = p_job_id;

  update public.document_versions
    set status = 'queued', last_error = null, updated_at = now()
    where id = v_job.version_id;

  update public.documents
    set status = 'queued', last_error = null, updated_at = now()
    where id = v_job.document_id;

  return true;
end;
$$;

revoke all on function public.retry_ingestion_job(uuid)
  from public, anon, service_role;
grant execute on function public.retry_ingestion_job(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Deletion: queue storage keys before cascading the document rows
-- ---------------------------------------------------------------------------

create or replace function public.delete_document_for_owner(p_document_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_deleted integer;
begin
  if v_owner is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  insert into public.storage_cleanup_queue (owner_id, storage_key)
  select v_owner, versions.storage_key
  from public.document_versions versions
  where versions.document_id = p_document_id
    and versions.owner_id = v_owner
  on conflict (storage_key) do nothing;

  delete from public.documents
  where id = p_document_id and owner_id = v_owner;

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;

  return v_deleted;
end;
$$;

revoke all on function public.delete_document_for_owner(uuid)
  from public, anon, service_role;
grant execute on function public.delete_document_for_owner(uuid)
  to authenticated;

create or replace function public.claim_storage_cleanup(p_limit integer)
returns table (id bigint, storage_key text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 20);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  return query
  update public.storage_cleanup_queue queue
    set attempts = queue.attempts + 1,
        available_at = now() + interval '5 minutes'
    where queue.id in (
      select due.id
      from public.storage_cleanup_queue due
      where due.available_at <= now()
      order by due.id
      limit v_limit
      for update skip locked
    )
    returning queue.id, queue.storage_key;
end;
$$;

revoke all on function public.claim_storage_cleanup(integer)
  from public, anon, service_role;
grant execute on function public.claim_storage_cleanup(integer)
  to authenticated;

create or replace function public.complete_storage_cleanup(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  delete from public.storage_cleanup_queue where id = p_id;
end;
$$;

revoke all on function public.complete_storage_cleanup(bigint)
  from public, anon, service_role;
grant execute on function public.complete_storage_cleanup(bigint)
  to authenticated;

create or replace function public.fail_storage_cleanup(p_id bigint, p_error text)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  update public.storage_cleanup_queue
    set available_at = now() + make_interval(
          secs => least(3600, 30 * power(2, attempts))
        ),
        last_error = left(coalesce(nullif(trim(p_error), ''), 'Storage cleanup failed.'), 1000)
    where id = p_id;
end;
$$;

revoke all on function public.fail_storage_cleanup(bigint, text)
  from public, anon, service_role;
grant execute on function public.fail_storage_cleanup(bigint, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Private upload bucket (hosted Supabase only)
-- ---------------------------------------------------------------------------

do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public)
    values ('document-uploads', 'document-uploads', false)
    on conflict (id) do nothing;

    drop policy if exists "Atlas owners can read their uploads" on storage.objects;
    create policy "Atlas owners can read their uploads"
      on storage.objects for select
      to authenticated
      using (
        bucket_id = 'document-uploads'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      );

    drop policy if exists "Atlas owners can write their uploads" on storage.objects;
    create policy "Atlas owners can write their uploads"
      on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'document-uploads'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      );

    drop policy if exists "Atlas owners can delete their uploads" on storage.objects;
    create policy "Atlas owners can delete their uploads"
      on storage.objects for delete
      to authenticated
      using (
        bucket_id = 'document-uploads'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      );
  end if;
end;
$storage$;
