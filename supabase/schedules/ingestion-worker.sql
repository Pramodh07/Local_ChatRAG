create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

select cron.unschedule(jobid)
from cron.job
where jobname = 'atlas-ingestion-worker';

select cron.schedule(
  'atlas-ingestion-worker',
  '* * * * *',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'atlas_ingestion_worker_url'
      ),
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'atlas_ingestion_worker_secret'
        ),
        'Content-Type',
        'application/json'
      ),
      body := '{}'::jsonb
    );
  $job$
);
