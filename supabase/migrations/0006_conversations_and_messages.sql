-- Phase 2: persist conversations and messages for Supabase-backed accounts.
--
-- The client sends the full conversation list on save, so the API replaces the
-- owner's stored set. Owner IDs are repeated on messages to keep every RLS
-- check a direct column comparison; the policy additionally verifies that the
-- parent conversation belongs to the same user so a forged conversation_id
-- cannot write into another account's history.

create table if not exists public.conversations (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation'
    check (char_length(title) between 1 and 200),
  archived_at_ms bigint
    check (archived_at_ms is null or archived_at_ms >= 0),
  updated_at_ms bigint not null
    check (updated_at_ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_owner_updated_idx
  on public.conversations (owner_id, updated_at_ms desc);

create table if not exists public.messages (
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '' check (char_length(content) <= 100000),
  status text not null check (status in ('streaming', 'done', 'stopped', 'error')),
  stage text check (stage is null or stage in ('retrieving', 'done')),
  citations jsonb,
  tokens integer check (tokens is null or tokens >= 0),
  sequence integer not null check (sequence >= 0),
  created_at_ms bigint not null check (created_at_ms >= 0),
  created_at timestamptz not null default now(),
  unique (conversation_id, sequence)
);

create index if not exists messages_conversation_sequence_idx
  on public.messages (conversation_id, sequence);

create index if not exists messages_owner_id_idx
  on public.messages (owner_id);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

revoke all on public.conversations, public.messages from anon, authenticated;
grant select, insert, update, delete on public.conversations, public.messages to authenticated;

drop policy if exists "Users can access their conversations" on public.conversations;
create policy "Users can access their conversations"
  on public.conversations for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Users can access their messages" on public.messages;
create policy "Users can access their messages"
  on public.messages for all
  to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.conversations
      where conversations.id = messages.conversation_id
        and conversations.owner_id = (select auth.uid())
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.conversations
      where conversations.id = messages.conversation_id
        and conversations.owner_id = (select auth.uid())
    )
  );

-- The client saves the complete conversation list. Replace it in one
-- transaction so a failed insert cannot leave a half-rewritten history.
-- SECURITY INVOKER keeps every statement subject to the RLS policies above.
create or replace function public.replace_conversations(
  p_owner_id uuid,
  p_conversations jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_owner_id is null or p_owner_id <> (select auth.uid()) then
    raise exception 'Conversation owner does not match the authenticated user.'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_conversations) <> 'array' then
    raise exception 'Conversations must be a JSON array.'
      using errcode = '22023';
  end if;

  delete from public.messages where owner_id = (select auth.uid());
  delete from public.conversations where owner_id = (select auth.uid());

  insert into public.conversations (id, owner_id, title, archived_at_ms, updated_at_ms)
  select
    (conversation ->> 'id')::uuid,
    (select auth.uid()),
    conversation ->> 'title',
    nullif(conversation ->> 'archivedAt', '')::bigint,
    (conversation ->> 'updatedAt')::bigint
  from jsonb_array_elements(p_conversations) as conversation;

  insert into public.messages (
    id,
    conversation_id,
    owner_id,
    role,
    content,
    status,
    stage,
    citations,
    tokens,
    sequence,
    created_at_ms
  )
  select
    (message ->> 'id')::uuid,
    (conversation ->> 'id')::uuid,
    (select auth.uid()),
    message ->> 'role',
    coalesce(message ->> 'content', ''),
    message ->> 'status',
    nullif(message ->> 'stage', ''),
    message -> 'citations',
    nullif(message ->> 'tokens', '')::integer,
    (ordinality - 1)::integer,
    (message ->> 'createdAt')::bigint
  from jsonb_array_elements(p_conversations) as conversation
  cross join lateral jsonb_array_elements(conversation -> 'messages')
    with ordinality as entry(message, ordinality);

  return jsonb_array_length(p_conversations);
end;
$$;

revoke all on function public.replace_conversations(uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.replace_conversations(uuid, jsonb)
  to authenticated;
