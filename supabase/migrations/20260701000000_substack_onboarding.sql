-- Substack onboarding: the connected publication and the creator's global
-- per-word price chosen at the end of onboarding.
alter table public.creators
  add column if not exists substack_subdomain text,
  add column if not exists substack_publication_name text,
  add column if not exists substack_logo_url text,
  add column if not exists default_price_per_word_atomic text;
