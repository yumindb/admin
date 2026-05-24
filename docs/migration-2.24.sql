-- ==========================================================================
-- Migration 2.24 — daily_logs DELETE 審計 + 「卡住日誌強制處理」
-- ==========================================================================
-- 為什麼:
--   業務面:工地主任送出日誌後忘了複核 / 助理請假沒人代審,日誌會永遠卡在
--   current_stage(stuck)。沒有清理機制 → 簽核清單會混亂。
--
--   解法分兩層:
--     1. 卡 >= 7 天 → 老闆 / 辦公室助理可「強制退回填表人」(status='rejected',
--        填表人能編輯後重送或刪除)。走原本的 rejectStageAction 流,只是不檢查
--        role-stage 對應。
--     2. 卡 >= 30 天 → 老闆 / 辦公室助理可「直接刪除整份日誌」。要審計留證據。
--
-- 本檔案做:
--   - 對 daily_logs 掛 audit trigger,只記 DELETE(全欄位 before_values),
--     讓「誰在何時刪了哪份日誌」永遠可查。
--   - UPDATE 不記(已經有 daily_log_revisions 在追編輯)。
--
-- 冪等。Supabase SQL Editor 整份貼。
-- ==========================================================================

drop trigger if exists trg_daily_logs_audit on public.daily_logs;
create trigger trg_daily_logs_audit
  after delete on public.daily_logs
  for each row execute function public.audit_trigger_fn();

-- 驗證:
--   delete from daily_logs where id = 'xxx';
--   select changed_at, changed_by, before_values->'log_date'
--     from audit_logs where table_name = 'daily_logs' order by changed_at desc limit 5;
