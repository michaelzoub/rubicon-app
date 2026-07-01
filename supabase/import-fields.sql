-- Adds import provenance to public.articles for the "Import from URL" flow.
--
-- Drafts created by pasting a Substack or X URL carry where they came from and
-- whether only a partial (preview-only) import was possible. All columns are
-- nullable / defaulted so existing hand-authored articles are unaffected.
--
-- Idempotent: safe to run multiple times. Run in the Supabase SQL editor.

alter table public.articles
  add column if not exists is_imported          boolean      not null default false,
  add column if not exists source_platform      text,                 -- 'substack' | 'x'
  add column if not exists source_url           text,
  add column if not exists source_author_name   text,
  add column if not exists source_author_handle text,
  add column if not exists source_published_at  timestamptz,
  add column if not exists imported_at           timestamptz,
  add column if not exists import_warnings       jsonb        not null default '[]'::jsonb,
  add column if not exists is_partial_import      boolean      not null default false;

-- Constrain the platform to known sources when present.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'articles_source_platform_check'
  ) then
    alter table public.articles
      add constraint articles_source_platform_check
      check (source_platform is null or source_platform in ('substack', 'x'));
  end if;
end $$;
