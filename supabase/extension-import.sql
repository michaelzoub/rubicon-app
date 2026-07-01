-- Browser-extension auth: extension_tokens + RLS.
--
-- The "Send to Rubicon" Chrome extension authenticates with a long-lived bearer
-- token the creator generates in Settings. Source provenance for the drafts it
-- creates is stored on `public.articles` by supabase/import-fields.sql (the same
-- columns the dashboard "Import from URL" flow uses) — so this file only adds
-- the token table.
--
-- Run this whole file in the Supabase SQL editor after the base schema and
-- supabase/import-fields.sql. Mirrors the JWT-sub ownership model in
-- supabase/policies.sql: `sub` is the Privy user id (e.g. did:privy:...), NOT a
-- UUID, so compare against (auth.jwt() ->> 'sub'), never auth.uid().

-- ---------------------------------------------------------------------------
-- extension_tokens
--
-- The token plaintext is never stored. The creator's browser generates it,
-- shows it once, and persists only token_hash (SHA-256 hex) + token_prefix.
-- The server (service role) looks tokens up by hash; the dashboard (RLS) only
-- ever reads/writes its own rows.
-- ---------------------------------------------------------------------------
create table if not exists public.extension_tokens (
  id           text primary key,
  creator_id   text not null references public.creators(id) on delete cascade,
  token_hash   text not null unique,
  token_prefix text not null,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists extension_tokens_creator_id_idx on public.extension_tokens (creator_id);
create index if not exists extension_tokens_token_hash_idx on public.extension_tokens (token_hash);

alter table public.extension_tokens enable row level security;

-- Owners manage their own tokens from the dashboard. The stored hash is not
-- reversible, so column-level restriction is unnecessary. Server token lookups
-- use the service role and bypass RLS entirely.
drop policy if exists extension_tokens_rw_own on public.extension_tokens;
create policy extension_tokens_rw_own on public.extension_tokens
  for all to authenticated
  using (creator_id = auth.jwt() ->> 'sub')
  with check (creator_id = auth.jwt() ->> 'sub');
