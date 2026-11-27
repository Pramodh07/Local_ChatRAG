create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_email_lower_key
  on public.profiles (lower(email))
  where email is not null;

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

drop policy if exists "Users can read their profile" on public.profiles;
create policy "Users can read their profile"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  metadata_name text;
begin
  metadata_name := left(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 100);
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(metadata_name, ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Account'
    )
  )
  on conflict (id) do update
  set email = excluded.email,
      display_name = excluded.display_name,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.sync_auth_user_profile();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of email, raw_user_meta_data on auth.users
  for each row execute procedure public.sync_auth_user_profile();

revoke all on function public.sync_auth_user_profile()
  from public, anon, authenticated;

insert into public.profiles (id, email, display_name)
select
  users.id,
  users.email,
  coalesce(
    nullif(left(trim(coalesce(users.raw_user_meta_data ->> 'display_name', '')), 100), ''),
    nullif(split_part(coalesce(users.email, ''), '@', 1), ''),
    'Account'
  )
from auth.users as users
on conflict (id) do nothing;

alter table public.documents
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

do $$
begin
  if exists (select 1 from public.documents where owner_id is null) then
    raise exception 'Assign existing documents to their owner before applying 0002_secure_user_access.sql.';
  end if;
end;
$$;

alter table public.documents alter column owner_id set not null;

revoke all on public.documents, public.document_chunks from anon, authenticated;
grant select, insert, delete on public.documents, public.document_chunks to authenticated;
grant usage on schema extensions to authenticated;

drop policy if exists "Users can access their documents" on public.documents;
create policy "Users can access their documents"
  on public.documents for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Users can access chunks from their documents" on public.document_chunks;
create policy "Users can access chunks from their documents"
  on public.document_chunks for all
  to authenticated
  using (
    exists (
      select 1
      from public.documents
      where documents.id = document_chunks.document_id
        and documents.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.documents
      where documents.id = document_chunks.document_id
        and documents.owner_id = (select auth.uid())
    )
  );

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
    and 1 - (chunks.embedding <=> query_embedding) >= match_threshold
  order by chunks.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;

revoke all on function public.match_documents(extensions.vector, integer, real)
  from public, anon, service_role;
grant execute on function public.match_documents(extensions.vector, integer, real)
  to authenticated;
