-- ==========================================================================
-- Migration 2.37 — 審閱改成「加簽」:拿掉審閱關的 policy 與開關
-- ==========================================================================
-- 用途:
--   2026-09-13 業主定案:審閱人的動作**跟流程無關** — 辦公室審核通過後隨時可以
--   加簽,只留在系統、不進 PDF,不擋核定。09-09 那版把它做成關卡(migration-2.36),
--   這支把關卡相關的東西拿掉:
--     1. daily_logs 的 logs_reviewer_stage_update:加簽不動 daily_logs,不需要
--     2. app_settings 的 approval.review_stage_enabled:沒有關卡就沒有開關
--
-- 留著的:
--   - log_approvals 的 approvals_review_insert(reviewer 寫 stage='review')— 加簽就是寫這筆
--   - profiles 讀取含 reviewer — 待加簽清單要顯示主任姓名
--   - user_role 的 reviewer 值(migration-2.35)
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
-- ==========================================================================

drop policy if exists logs_reviewer_stage_update on public.daily_logs;

delete from public.app_settings where key = 'approval.review_stage_enabled';

notify pgrst, 'reload schema';

-- 驗證:daily_logs 不該再有 logs_reviewer_stage_update;app_settings 應為空(目前沒有其他設定)
select policyname, cmd from pg_policies
  where schemaname = 'public' and tablename = 'daily_logs'
  order by policyname;
select key, value from public.app_settings order by key;
