-- Phase 0 fixes for confirmed audit findings.
--
-- SEC-02 / DB-17: `profiles` previously granted only SELECT and defined only a
-- SELECT policy, so the avatar route's profile update silently affected zero
-- rows. Allow an authenticated user to update only their own avatar column.
grant update (avatar_url) on public.profiles to authenticated;

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- DB-05: every RLS check and retrieval call filters documents by owner.
-- Use a non-concurrent index here because Supabase migrations run in a
-- transaction; build concurrently out-of-band for large production tables.
create index if not exists documents_owner_id_idx
  on public.documents (owner_id);
