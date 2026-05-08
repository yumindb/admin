-- ==========================================================================
-- Migration 2.15 — 辦公室助理 / 老闆可刪 / 封存 field_reports
-- ==========================================================================
-- 為什麼:
--   2026-05-08 業主回饋:現場回報若主任沒併進日誌,辦公室助理會定期處理 —
--   有時補併、有時下載照片後刪掉。現有 RLS(2.10):
--     - 作者可改自己 pending(reports_author_write,適用於現場助理 / 主任 / 老闆作者)
--     - office_staff / supervisor / owner 可 UPDATE(供 merge,reports_office_merge)
--     - office_staff / owner 沒有 DELETE 權限
--
-- 解法:
--   加一條 DELETE policy,限制 office_staff / owner 可刪 status='pending'
--   或 status='archived' 的 field_reports。
--   merged 的不可實刪 — 因為 daily_logs 還有 merged_into_log_id 反向引用,
--   砍掉會讓 daily log 顯示斷鏈;merged 想清乾淨改用「封存」。
--
-- 跑法: Supabase SQL Editor 整份貼上。冪等(drop if exists 後 create)。
-- ==========================================================================

drop policy if exists reports_office_delete on public.field_reports;

create policy reports_office_delete on public.field_reports
  for delete
  to authenticated
  using (
    public.current_user_role() in ('office_staff','owner')
    and status in ('pending', 'archived')
  );

-- 通知 PostgREST 重整 schema cache
notify pgrst, 'reload schema';

-- 驗證
select policyname, cmd, qual, with_check
  from pg_policies
  where schemaname = 'public' and tablename = 'field_reports'
  order by policyname;
