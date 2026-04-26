-- ==========================================================================
-- Phase 2.3 migration — 四關正式簽核流
-- ==========================================================================
-- 取消 POC 的 review + audit auto-pass。每關都要對應角色的人手動點通過。
-- 流程:
--   draft →[submit]→ submitted + current_stage='review'
--                  →[supervisor 通過]→ submitted + current_stage='audit'
--                  →[office_staff 通過]→ submitted + current_stage='approve'
--                  →[owner 通過 + 簽名]→ approved (current_stage=null)
--   任一關退回 → rejected (current_stage=null);supervisor 編輯後重送回 review
--
-- 跑法:Supabase SQL Editor 整份貼上。冪等。
-- ==========================================================================

-- 1. daily_logs 加 current_stage 欄(approval_stage enum,nullable)
alter table public.daily_logs
  add column if not exists current_stage public.approval_stage;

comment on column public.daily_logs.current_stage is
  'submitted 時表當前在哪關;draft/approved/rejected 時為 null';

-- 2. 既有資料 backfill:
--    舊資料 submitted 狀態都有自動寫的 review + audit approvals(POC 階段),
--    所以只剩 owner 那關 → current_stage='approve'
update public.daily_logs
set current_stage = 'approve'
where status = 'submitted' and current_stage is null;

-- 3. 加 partial index 加速「我這關該做什麼」查詢
create index if not exists daily_logs_current_stage_idx
  on public.daily_logs(current_stage)
  where current_stage is not null;

-- 4. 驗證
select status, current_stage, count(*)
from public.daily_logs
group by status, current_stage
order by status, current_stage;
