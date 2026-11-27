-- Persist conversation changes as independent message records instead of
-- replacing the owner's complete chat snapshot.

alter table public.messages
  drop constraint if exists messages_conversation_id_sequence_key;

drop index if exists public.messages_conversation_sequence_idx;
create index messages_conversation_sequence_idx
  on public.messages (conversation_id, sequence, created_at_ms, id);

revoke all on function public.replace_conversations(uuid, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.upsert_conversation_messages(
  p_owner_id uuid,
  p_conversation jsonb,
  p_messages jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_message jsonb;
  v_written integer := 0;
  v_count integer;
begin
  if v_owner is null or p_owner_id is null or p_owner_id <> v_owner then
    raise exception 'Conversation owner does not match the authenticated user.'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_conversation) <> 'object'
     or jsonb_typeof(p_messages) <> 'array' then
    raise exception 'Conversation changes have an invalid format.'
      using errcode = '22023';
  end if;

  insert into public.conversations (id, owner_id, title, archived_at_ms, updated_at_ms)
  values (
    (p_conversation ->> 'id')::uuid,
    v_owner,
    p_conversation ->> 'title',
    nullif(p_conversation ->> 'archivedAt', '')::bigint,
    (p_conversation ->> 'updatedAt')::bigint
  )
  on conflict (id) do update
    set title = excluded.title,
        archived_at_ms = excluded.archived_at_ms,
        updated_at_ms = excluded.updated_at_ms,
        updated_at = now()
  where conversations.owner_id = v_owner
    and conversations.updated_at_ms <= excluded.updated_at_ms;

  for v_message in select value from jsonb_array_elements(p_messages)
  loop
    insert into public.messages (
      id, conversation_id, owner_id, role, content, status, stage,
      citations, tokens, sequence, created_at_ms
    )
    values (
      (v_message ->> 'id')::uuid,
      (p_conversation ->> 'id')::uuid,
      v_owner,
      v_message ->> 'role',
      coalesce(v_message ->> 'content', ''),
      v_message ->> 'status',
      nullif(v_message ->> 'stage', ''),
      v_message -> 'citations',
      nullif(v_message ->> 'tokens', '')::integer,
      (v_message ->> 'sequence')::integer,
      (v_message ->> 'createdAt')::bigint
    )
    on conflict (id) do update
      set content = excluded.content,
          status = excluded.status,
          stage = excluded.stage,
          citations = excluded.citations,
          tokens = excluded.tokens,
          sequence = excluded.sequence
    where messages.owner_id = v_owner
      and messages.conversation_id = excluded.conversation_id
      and messages.created_at_ms <= excluded.created_at_ms;

    get diagnostics v_count = row_count;
    v_written := v_written + v_count;
  end loop;

  return v_written;
end;
$$;

revoke all on function public.upsert_conversation_messages(uuid, jsonb, jsonb)
  from public, anon, service_role;
grant execute on function public.upsert_conversation_messages(uuid, jsonb, jsonb)
  to authenticated;

-- Service-role requests are restricted to server-side worker deployments. The
-- claim function still uses row locks and returns owner IDs so each processing
-- step can retain the queue's owner-scoped lifecycle checks.

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
  v_service_role boolean := current_user = 'service_role';
begin
  if auth.uid() is null and not v_service_role then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  return query
  with due as (
    select jobs.id
    from public.ingestion_jobs jobs
    where ((jobs.status = 'queued' and jobs.available_at <= now())
       or (jobs.status = 'processing'
           and jobs.locked_at < now() - interval '10 minutes'))
      and (v_service_role or jobs.owner_id = auth.uid())
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

grant execute on function public.claim_ingestion_jobs(text, integer)
  to service_role;

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
  v_service_role boolean := current_user = 'service_role';
  v_job record;
begin
  if v_owner is null and not v_service_role then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select jobs.document_id, jobs.version_id
    into v_job
  from public.ingestion_jobs jobs
  where jobs.id = p_job_id
    and (v_service_role or jobs.owner_id = v_owner)
    and jobs.status = 'processing'
  for update;

  if not found then
    raise exception 'Ingestion job is not available for processing.'
      using errcode = 'P0002';
  end if;

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

grant execute on function public.begin_ingestion_attempt(uuid)
  to service_role;

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
  v_service_role boolean := current_user = 'service_role';
  v_job record;
begin
  if v_owner is null and not v_service_role then
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
    and (v_service_role or jobs.owner_id = v_owner)
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

grant execute on function public.complete_ingestion_job(uuid, integer, integer, text)
  to service_role;

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
  v_service_role boolean := current_user = 'service_role';
  v_job record;
  v_message text := left(coalesce(nullif(trim(p_error), ''), 'Ingestion failed.'), 1000);
  v_status text;
begin
  if v_owner is null and not v_service_role then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select jobs.document_id, jobs.version_id, jobs.attempts, jobs.max_attempts
    into v_job
  from public.ingestion_jobs jobs
  where jobs.id = p_job_id
    and (v_service_role or jobs.owner_id = v_owner)
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

grant execute on function public.fail_ingestion_job(uuid, text, boolean)
  to service_role;

create or replace function public.claim_storage_cleanup(p_limit integer)
returns table (id bigint, storage_key text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 20);
  v_owner uuid := auth.uid();
  v_service_role boolean := current_user = 'service_role';
begin
  if v_owner is null and not v_service_role then
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
        and (v_service_role or due.owner_id = v_owner)
      order by due.id
      limit v_limit
      for update skip locked
    )
    returning queue.id, queue.storage_key;
end;
$$;

grant execute on function public.claim_storage_cleanup(integer)
  to service_role;

create or replace function public.complete_storage_cleanup(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_service_role boolean := current_user = 'service_role';
begin
  if auth.uid() is null and not v_service_role then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  delete from public.storage_cleanup_queue
  where id = p_id
    and (v_service_role or owner_id = auth.uid());
end;
$$;

grant execute on function public.complete_storage_cleanup(bigint)
  to service_role;

create or replace function public.fail_storage_cleanup(p_id bigint, p_error text)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_service_role boolean := current_user = 'service_role';
begin
  if auth.uid() is null and not v_service_role then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  update public.storage_cleanup_queue
    set available_at = now() + make_interval(
          secs => least(3600, 30 * power(2, attempts))
        ),
        last_error = left(coalesce(nullif(trim(p_error), ''), 'Storage cleanup failed.'), 1000)
    where id = p_id
      and (v_service_role or owner_id = auth.uid());
end;
$$;

grant execute on function public.fail_storage_cleanup(bigint, text)
  to service_role;
