-- Permanently delete a creator-owned article and every Supabase row tied to it.
-- The function is transactional: a failure rolls the entire deletion back.
create or replace function public.delete_article_permanently(target_article_id text)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  owned_article_id text;
begin
  select id
    into owned_article_id
    from public.articles
   where id = target_article_id
     and creator_id = auth.jwt() ->> 'sub'
   for update;

  if owned_article_id is null then
    return false;
  end if;

  delete from public.word_payments where article_id = owned_article_id;
  delete from public.stream_sessions where article_id = owned_article_id;
  delete from public.article_revisions where article_id = owned_article_id;
  delete from public.article_sections where article_id = owned_article_id;
  delete from public.articles where id = owned_article_id;

  return true;
end;
$$;

revoke all on function public.delete_article_permanently(text) from public;
grant execute on function public.delete_article_permanently(text) to authenticated;
grant execute on function public.delete_article_permanently(text) to service_role;
