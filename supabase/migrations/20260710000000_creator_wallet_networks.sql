-- A creator may receive on more than one settlement network. Keep every
-- wallet on the existing creator-owned registry instead of creating a
-- platform or AgentCash-specific wallet record.
alter table public.creator_wallets
  drop constraint if exists creator_wallets_pkey;

alter table public.creator_wallets
  add primary key (creator_id, network);
