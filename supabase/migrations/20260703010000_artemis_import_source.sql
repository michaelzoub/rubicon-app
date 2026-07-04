-- Artemis URL and onboarding imports persist their source on articles.
-- Older databases still have the original Substack/X-only check constraint,
-- which rejects the entire bulk publish insert with Postgres error 23514.
alter table public.articles
  drop constraint if exists articles_source_platform_check;

alter table public.articles
  add constraint articles_source_platform_check
  check (source_platform is null or source_platform in ('substack', 'x', 'artemis'));
