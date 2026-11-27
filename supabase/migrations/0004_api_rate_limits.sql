create table if not exists public.api_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('chat', 'document_upload')),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (user_id, action)
);

alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from anon, authenticated;

create or replace function public.consume_api_rate_limit(p_action text)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  request_limit integer;
  window_seconds integer;
  current_window timestamptz;
  current_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication is required to consume an API rate limit.';
  end if;

  case p_action
    when 'chat' then
      request_limit := 20;
      window_seconds := 60;
    when 'document_upload' then
      request_limit := 5;
      window_seconds := 3600;
    else
      raise exception 'Unsupported API rate-limit action.';
  end case;

  current_window := pg_catalog.date_bin(
    pg_catalog.make_interval(secs => window_seconds),
    statement_timestamp(),
    'epoch'::timestamptz
  );

  insert into public.api_rate_limits (
    user_id,
    action,
    window_started_at,
    request_count
  )
  values (current_user_id, p_action, current_window, 1)
  on conflict (user_id, action) do update
  set
    window_started_at = excluded.window_started_at,
    request_count = case
      when public.api_rate_limits.window_started_at = excluded.window_started_at
        then least(public.api_rate_limits.request_count + 1, request_limit + 1)
      else 1
    end
  returning request_count, window_started_at
  into current_count, current_window;

  return query
  select
    current_count <= request_limit,
    greatest(
      1,
      ceil(
        extract(
          epoch from (
            current_window
            + pg_catalog.make_interval(secs => window_seconds)
            - statement_timestamp()
          )
        )
      )::integer
    );
end;
$$;

revoke all on function public.consume_api_rate_limit(text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_api_rate_limit(text) to authenticated;
