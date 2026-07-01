-- Rubicon dashboard RLS policies.
--
-- The Next.js route /api/auth/supabase-token mints an HS256 JWT whose `sub`
-- claim is the Privy user id (e.g. did:privy:...). That is NOT a UUID, so do
-- NOT use auth.uid() in these policies -- compare against (auth.jwt() ->> 'sub').
--
-- Run this whole file in the Supabase SQL editor.

-- helper: the calling creator's id from the JWT
-- (inlined as auth.jwt() ->> 'sub' below; no function needed)

-- ---------------------------------------------------------------------------
-- creators (id = Privy user id)
-- ---------------------------------------------------------------------------
alter table public.creators enable row level security;

drop policy if exists creators_select_own on public.creators;
drop policy if exists creators_insert_own on public.creators;
drop policy if exists creators_update_own on public.creators;

create policy creators_select_own on public.creators
  for select to authenticated
  using (id = auth.jwt() ->> 'sub');

create policy creators_insert_own on public.creators
  for insert to authenticated
  with check (id = auth.jwt() ->> 'sub');

create policy creators_update_own on public.creators
  for update to authenticated
  using (id = auth.jwt() ->> 'sub')
  with check (id = auth.jwt() ->> 'sub');

-- ---------------------------------------------------------------------------
-- child tables keyed by creator_id
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'creator_profiles',
    'creator_wallets',
    'articles',
    'stream_sessions',
    'word_payments'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_rw_own', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (creator_id = auth.jwt() ->> ''sub'') '
      || 'with check (creator_id = auth.jwt() ->> ''sub'');',
      t || '_rw_own', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- tables keyed indirectly via article_id (scope through the parent article)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'article_sections',
    'article_revisions'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_rw_own', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (exists (select 1 from public.articles a where a.id = %I.article_id and a.creator_id = auth.jwt() ->> ''sub'')) '
      || 'with check (exists (select 1 from public.articles a where a.id = %I.article_id and a.creator_id = auth.jwt() ->> ''sub''));',
      t || '_rw_own', t, t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- public (anon) read access for the Explore directory
--
-- The /explore page reads with the anon key (no service-role key in the
-- browser-facing env). Without these policies RLS returns zero rows and the
-- catalog renders empty. Scope is restricted to *live* articles and the
-- creators/profiles/sections attached to them -- drafts and private data stay
-- hidden. Policies are additive (OR), so authenticated owners keep full access
-- to their own rows via the policies above.
-- ---------------------------------------------------------------------------

-- Supabase grants SELECT to anon/authenticated by default; re-assert to be safe.
grant select on public.articles to anon, authenticated;
grant select on public.creators to anon, authenticated;
grant select on public.creator_profiles to anon, authenticated;
grant select on public.article_sections to anon, authenticated;

-- live articles are publicly readable
drop policy if exists articles_select_public_live on public.articles;
create policy articles_select_public_live on public.articles
  for select to anon, authenticated
  using (state = 'live');

-- creators who have at least one live article are publicly readable
drop policy if exists creators_select_public on public.creators;
create policy creators_select_public on public.creators
  for select to anon, authenticated
  using (exists (
    select 1 from public.articles a
    where a.creator_id = creators.id and a.state = 'live'
  ));

-- profiles of creators who have at least one live article
drop policy if exists creator_profiles_select_public on public.creator_profiles;
create policy creator_profiles_select_public on public.creator_profiles
  for select to anon, authenticated
  using (exists (
    select 1 from public.articles a
    where a.creator_id = creator_profiles.creator_id and a.state = 'live'
  ));

-- section headings belonging to live articles
drop policy if exists article_sections_select_public on public.article_sections;
create policy article_sections_select_public on public.article_sections
  for select to anon, authenticated
  using (exists (
    select 1 from public.articles a
    where a.id = article_sections.article_id and a.state = 'live'
  ));
