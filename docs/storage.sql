-- ==========================================================================
-- Phase 2 — Storage buckets
-- ==========================================================================
-- 建兩個 bucket:
--   - daily-photos: 工地主任日誌照片
--   - signatures:   老闆核定簽名
--
-- POC 簡化:兩個 bucket 都設 public,允許 authenticated 上傳。正式版改 private
-- + signed URL,並依 case_id 限定下載權。
--
-- 跑法:Supabase SQL Editor 整份貼上執行。冪等。
-- ==========================================================================

-- 1. 建 buckets
insert into storage.buckets (id, name, public)
values ('daily-photos', 'daily-photos', true)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('signatures', 'signatures', true)
on conflict (id) do update set public = excluded.public;


-- 2. RLS policies
-- 先把舊的 policies 刪掉(冪等)
do $$
declare
  r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in (
        'poc_daily_photos_read',
        'poc_daily_photos_write',
        'poc_signatures_read',
        'poc_signatures_write'
      )
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- daily-photos: authenticated 可讀寫;public 也可讀(因為 bucket 是 public)
create policy poc_daily_photos_read
  on storage.objects for select
  to public
  using (bucket_id = 'daily-photos');

create policy poc_daily_photos_write
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'daily-photos');

-- signatures: 同上
create policy poc_signatures_read
  on storage.objects for select
  to public
  using (bucket_id = 'signatures');

create policy poc_signatures_write
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'signatures');


-- 3. 驗證
select id, name, public from storage.buckets where id in ('daily-photos','signatures');
