-- ==========================================================================
-- Migration 2.29 — 核定關雙簽名(daily_logs.approve_signatures)
-- ==========================================================================
-- 用途:
--   2026-07-20 業主拍板:核定關要「兩位老闆(owner)都簽」才算完成。
--   不限順序,誰先簽都可以;同一個人不能簽兩次。
--
--   為什麼需要一個計數欄位而不是直接數 log_approvals:
--     兩位老闆同時按「核定通過」時,兩邊都可能讀到「目前 0 人簽」而各自
--     以為自己是第一位 → 兩張簽名都寫進去,但日誌永遠停在 approve 關。
--     這個欄位讓 server 用「條件式 UPDATE(compare-and-set)」序列化:
--       UPDATE ... SET approve_signatures = n+1 WHERE approve_signatures = n
--     同時只有一個請求會拿到 rows,另一個重讀後就知道自己是第二位。
--
--   為什麼不用 unique index(log_id, stage, approver_id):
--     退回後重送時,同一個人本來就會再簽同一關一次(第二輪),unique 會擋死。
--     「本輪已簽過的人」改用 log_approvals.created_at >= daily_logs.submitted_at 判斷。
--
--   重設時機(server action 負責,各自獨立語句):
--     - 退回 / 強制退回 → 0
--     - 主任編輯後重送 → 0
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
-- ==========================================================================

alter table public.daily_logs
  add column if not exists approve_signatures smallint not null default 0
    check (approve_signatures >= 0 and approve_signatures <= 2);

comment on column public.daily_logs.approve_signatures is
  '核定關已簽名人數(0-2)。雙簽制:兩位 owner 都簽完才 status=approved。退回/重送歸零。';

-- 已核定的舊資料:視為已完成雙簽,避免報表 / UI 把歷史日誌顯示成「等第二位簽」
update public.daily_logs
  set approve_signatures = 2
  where status = 'approved' and approve_signatures = 0;

-- 通知 PostgREST 重整 schema cache
notify pgrst, 'reload schema';

-- 驗證
select status, approve_signatures, count(*)
  from public.daily_logs
  group by 1, 2
  order by 1, 2;
