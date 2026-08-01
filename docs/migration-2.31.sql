-- ==========================================================================
-- Migration 2.31 — 撤回核定 / 強制退回 的簽核紀錄可寫入(log_approvals)
-- ==========================================================================
-- 用途:
--   2026-08 業主要求:辦公室助理要能修改主任填錯的日誌,包含**已核定**的。
--   作法是「撤回核定」— 把 approved 的日誌退回 audit 關,改完重走核定
--   (見 revokeApprovalAction)。撤回要在 log_approvals 留一筆紀錄:
--   誰、什麼時候、為什麼撤回。
--
--   問題:migration-2.10 的 INSERT policy 是嚴格的 stage × role 對應 —
--     approve 關只有 owner 能寫。辦公室助理撤回核定時要寫的正是
--     stage='approve' 的紀錄 → 被 RLS 擋掉,撤回動作本身成功但**沒有留下軌跡**。
--
--   同一個洞也影響既有的「強制退回卡住日誌」(forceRejectStuckLogAction):
--   助理強制退回一份卡在核定關的日誌時,那筆 log_approvals 也寫不進去。
--
-- 解法:
--   多開一條 policy — 只放行「decision='rejected'」的 approve 關紀錄,
--   且限 office_staff / owner。也就是說:
--     - 助理仍然**不能**在核定關寫「通過」(核定權沒有外流)
--     - 但可以寫「退回 / 撤回」這種把日誌往回送的紀錄
--   decision 欄位在 with check 裡直接比對,不需要 server 端額外保證。
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
-- ==========================================================================

drop policy if exists approvals_revoke_insert on public.log_approvals;

create policy approvals_revoke_insert on public.log_approvals
  for insert
  to authenticated
  with check (
    stage = 'approve'
    and decision = 'rejected'
    and approver_id = auth.uid()
    and public.current_user_role() in ('office_staff', 'owner')
  );

-- 通知 PostgREST 重整 schema cache
notify pgrst, 'reload schema';

-- 驗證:log_approvals 應有 5 條 INSERT policy(fill / review / audit / approve / revoke)
select policyname, cmd
  from pg_policies
  where schemaname = 'public' and tablename = 'log_approvals'
  order by policyname;
