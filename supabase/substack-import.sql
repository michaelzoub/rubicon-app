-- Private staging tables for creator-owned Substack exports. Safe to rerun.
create table if not exists public.creator_import_jobs (
  id text primary key, creator_id text not null references public.creators(id) on delete cascade,
  source text not null check (source = 'substack_export'),
  status text not null check (status in ('uploaded','parsed','imported','failed')),
  file_name text not null, total_posts integer not null default 0, published_posts integer not null default 0,
  imported_posts integer not null default 0, error_message text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.creator_import_candidates (
  id text primary key, import_job_id text not null references public.creator_import_jobs(id) on delete cascade,
  creator_id text not null references public.creators(id) on delete cascade, source_post_id text not null,
  title text not null, subtitle text not null default '', published_at timestamptz, audience text, type text,
  is_published boolean not null default true, word_count integer not null default 0, section_count integer not null default 0,
  original_html_private text not null default '', sanitized_html_private text not null default '', plain_text_private text not null default '',
  sections_json_private jsonb not null default '[]'::jsonb, public_index_json jsonb not null default '{}'::jsonb,
  recommended_price_per_word_cents numeric(10,3) not null, selected_price_per_word_cents numeric(10,3),
  estimated_max_price_cents numeric(14,3) not null, status text not null check (status in ('preview','imported','skipped','failed')),
  warning text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(import_job_id, source_post_id)
);

alter table public.creator_import_candidates
  add column if not exists original_html_private text not null default '';

alter table public.creator_import_jobs enable row level security;
alter table public.creator_import_candidates enable row level security;
drop policy if exists creator_import_jobs_rw_own on public.creator_import_jobs;
create policy creator_import_jobs_rw_own on public.creator_import_jobs for all to authenticated
  using (creator_id = auth.jwt() ->> 'sub') with check (creator_id = auth.jwt() ->> 'sub');
drop policy if exists creator_import_candidates_rw_own on public.creator_import_candidates;
create policy creator_import_candidates_rw_own on public.creator_import_candidates for all to authenticated
  using (creator_id = auth.jwt() ->> 'sub') with check (creator_id = auth.jwt() ->> 'sub');

revoke all on public.creator_import_jobs from anon;
revoke all on public.creator_import_candidates from anon;
grant select, insert, update, delete on public.creator_import_jobs to authenticated;
grant select, insert, update, delete on public.creator_import_candidates to authenticated;
