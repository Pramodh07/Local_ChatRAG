-- Append-only hardening for the service-role ingestion worker.
-- The queue RPCs are SECURITY INVOKER, so service_role needs explicit table
-- privileges. Authenticated users must never be able to claim or mutate jobs.

grant select, insert, update, delete on
  public.documents,
  public.document_versions,
  public.document_chunks,
  public.ingestion_jobs,
  public.storage_cleanup_queue
  to service_role;

grant usage, select, update on sequence public.storage_cleanup_queue_id_seq
  to service_role;

-- 0007 granted these RPCs to authenticated; 0009 added service_role grants but
-- did not revoke the browser role. Keep them service-role only.
revoke all on function public.claim_ingestion_jobs(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_ingestion_jobs(text, integer)
  to service_role;

revoke all on function public.begin_ingestion_attempt(uuid)
  from public, anon, authenticated;
grant execute on function public.begin_ingestion_attempt(uuid)
  to service_role;

revoke all on function public.complete_ingestion_job(uuid, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.complete_ingestion_job(uuid, integer, integer, text)
  to service_role;

revoke all on function public.fail_ingestion_job(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.fail_ingestion_job(uuid, text, boolean)
  to service_role;

revoke all on function public.claim_storage_cleanup(integer)
  from public, anon, authenticated;
grant execute on function public.claim_storage_cleanup(integer)
  to service_role;

revoke all on function public.complete_storage_cleanup(bigint)
  from public, anon, authenticated;
grant execute on function public.complete_storage_cleanup(bigint)
  to service_role;

revoke all on function public.fail_storage_cleanup(bigint, text)
  from public, anon, authenticated;
grant execute on function public.fail_storage_cleanup(bigint, text)
  to service_role;

-- A pre-existing bucket created outside 0007 may be public. Force privacy.
do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    update storage.buckets
       set public = false
     where id = 'document-uploads';
  end if;
end
$storage$;
