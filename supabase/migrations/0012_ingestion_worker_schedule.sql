-- Append-only: schedule the ingestion worker automatically when the Supabase
-- prerequisites (pg_cron, pg_net and the two Vault secrets) are present.
-- Environments without them keep the manual setup documented in README §6.

do $schedule$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    return;
  end if;

  begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  exception when others then
    -- Extensions may require dashboard-level enablement; stay no-op.
    return;
  end;

  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    return;
  end if;

  if not exists (
    select 1 from vault.secrets
    where name in ('atlas_ingestion_worker_url', 'atlas_ingestion_worker_secret')
    group by name
    having count(*) = 2
  ) then
    return;
  end if;

  if not exists (select 1 from cron.job where jobname = 'atlas-ingestion-worker') then
    perform cron.schedule(
      'atlas-ingestion-worker',
      '* * * * *',
      $job$
      select net.http_post(
        url := (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'atlas_ingestion_worker_url' limit 1
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret from vault.decrypted_secrets
            where name = 'atlas_ingestion_worker_secret' limit 1
          )
        ),
        body := '{}'::jsonb
      )
      $job$
    );
  end if;
end
$schedule$;
