-- Allows 'artemis' as an article source platform for the URL import flow.
--
-- Databases created before the Artemis importer carry the old two-platform
-- check constraint; recreate it with the expanded list. New databases get the
-- right constraint from import-fields.sql directly.
--
-- Idempotent: safe to run multiple times. Run in the Supabase SQL editor.

alter table public.articles
  drop constraint if exists articles_source_platform_check;

alter table public.articles
  add constraint articles_source_platform_check
  check (source_platform is null or source_platform in ('substack', 'x', 'artemis'));
