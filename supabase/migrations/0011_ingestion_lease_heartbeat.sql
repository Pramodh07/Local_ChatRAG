-- Append-only: let the service-role worker renew a job's lock while it embeds
-- a large document, so the 10-minute stale-lock recovery does not reclaim a
-- job that is still making progress.

create or replace function public.renew_ingestion_lease(p_job_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'service_role' then
    raise exception 'Only the service-role worker can renew an ingestion lease.'
      using errcode = '42501';
  end if;

  update public.ingestion_jobs
     set locked_at = now(), updated_at = now()
   where id = p_job_id and status = 'processing';

  return found;
end;
$$;

revoke all on function public.renew_ingestion_lease(uuid)
  from public, anon, authenticated;
grant execute on function public.renew_ingestion_lease(uuid)
  to service_role;
