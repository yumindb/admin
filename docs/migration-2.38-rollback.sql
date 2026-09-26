-- ==========================================================================
-- 還原 migration-2.38(只在 2.38 確定造成問題、需要回到原狀時使用)
-- ==========================================================================
-- 內容是 2026-09-26 套用 2.38 之前,從正式站讀出來的原始定義(pg_policies /
-- pg_get_functiondef / 權限查詢)。⚠ 還原會把 2.38 修掉的漏洞全部打開,
-- 比較好的做法通常是針對出問題的那一條單獨調整。
-- ==========================================================================

begin;

-- 1. profiles 欄位權限(原本:authenticated / anon 對整張表有 UPDATE)
grant update on public.profiles to anon, authenticated;

-- 2. handle_new_user 原始版本(角色取自 user_metadata,預設 office_staff,is_active 用欄位預設 true)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(
      (new.raw_user_meta_data->>'role')::public.user_role,
      'office_staff'::public.user_role
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 3. current_user_role 原始版本(不看 is_active)
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- 4. daily-log-pdfs 的 POC policy
drop policy if exists poc_daily_log_pdfs_read on storage.objects;
drop policy if exists poc_daily_log_pdfs_write on storage.objects;
drop policy if exists poc_daily_log_pdfs_update on storage.objects;
create policy poc_daily_log_pdfs_read on storage.objects
  for select to authenticated using (bucket_id = 'daily-log-pdfs');
create policy poc_daily_log_pdfs_write on storage.objects
  for insert to authenticated with check (bucket_id = 'daily-log-pdfs');
create policy poc_daily_log_pdfs_update on storage.objects
  for update to authenticated using (bucket_id = 'daily-log-pdfs');

-- 5. 日誌狀態守門 trigger
drop trigger if exists trg_daily_logs_guard on public.daily_logs;
drop function if exists public.guard_daily_log_write();

-- 6. function 權限(原本 PUBLIC / anon / authenticated 都有 EXECUTE)
grant execute on function public.audit_trigger_fn() to public, anon, authenticated;
grant execute on function public.handle_new_user() to public, anon, authenticated;
grant execute on function public.touch_updated_at() to public, anon, authenticated;
grant execute on function public.current_user_role() to public, anon, authenticated;
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'grant execute on function public.rls_auto_enable() to public, anon, authenticated';
  end if;
end $$;
alter function public.touch_updated_at() reset search_path;

-- 7. bucket 上限(原本都沒設)
update storage.buckets set file_size_limit = null, allowed_mime_types = null
 where id in ('daily-photos', 'signatures');

commit;

notify pgrst, 'reload schema';
