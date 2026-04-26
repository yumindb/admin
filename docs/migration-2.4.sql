-- ==========================================================================
-- Migration 2.4 — daily_logs.pdf_path
-- ==========================================================================
-- 用途：核定通過後自動產 PDF 並存到 Storage,把 storage path 寫到此欄位。
-- 後續日誌詳情頁、列表頁的「下載 PDF」按鈕從這裡撈 path → 換 signed URL。
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
-- ==========================================================================

alter table public.daily_logs
  add column if not exists pdf_path text;

create index if not exists daily_logs_pdf_path_idx
  on public.daily_logs(pdf_path)
  where pdf_path is not null;

-- 也建 daily-log-pdfs storage bucket(設 private,只能透過 signed URL 下載)
insert into storage.buckets (id, name, public)
values ('daily-log-pdfs', 'daily-log-pdfs', false)
on conflict (id) do update set public = excluded.public;

-- 清掉舊 policies(冪等)
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('poc_daily_log_pdfs_read', 'poc_daily_log_pdfs_write')
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- authenticated 可讀(配合 createSignedUrl);只有 service role / authenticated 可寫
create policy poc_daily_log_pdfs_read
  on storage.objects for select
  to authenticated
  using (bucket_id = 'daily-log-pdfs');

create policy poc_daily_log_pdfs_write
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'daily-log-pdfs');

create policy poc_daily_log_pdfs_update
  on storage.objects for update
  to authenticated
  using (bucket_id = 'daily-log-pdfs');

-- 驗證
select id, name, public from storage.buckets where id = 'daily-log-pdfs';
