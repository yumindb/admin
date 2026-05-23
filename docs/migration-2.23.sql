-- ==========================================================================
-- Migration 2.23 — 請假 (leave_requests + leave_approvals)
-- ==========================================================================
-- 用途:
--   員工請假流程。 field_assistant / site_supervisor / office_staff 可送請假;
--   走「上層全部都要過」的循序簽核鏈,owner 是最後一關。
--
--   簽核鏈(按申請人角色決定,送出時寫進 approval_chain 欄):
--     field_assistant  → site_supervisor → office_staff → owner
--     site_supervisor  → office_staff → owner
--     office_staff     → owner
--     owner            → 不能送(本人就是最高關;若日後要送可直接設 status='approved')
--
--   流程設計:
--     - 送出時 status='pending', current_step = chain[0]
--     - 該角色任一人通過 → 寫 leave_approvals, current_step 推到 chain 下一格
--     - 走完最後一關 → status='approved', current_step=null, resolved_at=now()
--     - 任一關退回 → status='rejected', current_step=null, resolved_at=now()
--                     (退回 = 整份否決;申請人要重送新的一份)
--     - 申請人可在 pending 期間自行取消(status='cancelled')
--
--   total_hours 由 server action 算好寫入(half-day 支援:0.5 / 1 / 4 / 8 ...)。
--   日期欄用 timestamptz(允許跨日 + 時段)。
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
-- ==========================================================================

-- ==========================================================================
-- ENUMs
-- ==========================================================================

do $$ begin
  create type leave_type as enum (
    'personal',    -- 事假
    'sick',        -- 病假
    'official',    -- 公假
    'annual',      -- 特休
    'menstrual',   -- 生理假
    'bereavement', -- 喪假
    'marriage',    -- 婚假
    'other'        -- 其他
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type leave_decision as enum ('approved', 'rejected');
exception when duplicate_object then null; end $$;


-- ==========================================================================
-- 1. leave_requests
-- ==========================================================================
create table if not exists public.leave_requests (
  id              uuid primary key default gen_random_uuid(),
  applicant_id    uuid not null references public.profiles(id) on delete restrict,
  applicant_role  user_role not null,                  -- 送出當下的角色快照(防後續改 role 影響流程)
  leave_type      leave_type not null,
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  total_hours     numeric(5, 1) not null check (total_hours > 0),
  reason          text not null,
  attachment_path text,                                 -- e.g. 病假診斷證明(POC 階段先留欄位,UI 未實作)
  status          leave_status not null default 'pending',
  current_step    user_role,                            -- 目前在哪個角色等簽;null = 已完結
  approval_chain  user_role[] not null,                 -- 簽核順序陣列,e.g. {office_staff, owner}
  submitted_at    timestamptz not null default now(),
  resolved_at     timestamptz,                          -- approved / rejected 的時間
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint leave_requests_end_after_start check (end_at > start_at),
  constraint leave_requests_chain_nonempty check (array_length(approval_chain, 1) >= 1)
);

create index if not exists leave_requests_applicant_idx
  on public.leave_requests(applicant_id, submitted_at desc);

create index if not exists leave_requests_status_step_idx
  on public.leave_requests(status, current_step)
  where status = 'pending';

create index if not exists leave_requests_dates_idx
  on public.leave_requests(start_at);


-- ==========================================================================
-- 2. leave_approvals — 簽核紀錄(每關一筆)
-- ==========================================================================
create table if not exists public.leave_approvals (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.leave_requests(id) on delete cascade,
  step_role    user_role not null,                     -- 這關屬於哪個角色
  approver_id  uuid references public.profiles(id) on delete set null,
  decision     leave_decision not null,
  comment      text,
  created_at   timestamptz not null default now()
);

create index if not exists leave_approvals_request_idx
  on public.leave_approvals(request_id, created_at);


-- ==========================================================================
-- updated_at trigger
-- ==========================================================================
do $$ begin
  create trigger trg_leave_requests_updated_at before update on public.leave_requests
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;


-- ==========================================================================
-- RLS
-- ==========================================================================
-- 政策:
--   leave_requests:
--     - SELECT:申請人本人 + office_staff + owner 永遠可看;
--              site_supervisor 看自己 + 自己在 approval_chain 內的(要簽的、簽過的)
--     - INSERT:本人,applicant_id = auth.uid()(server action 再守 role / chain)
--     - UPDATE:本人可改 status='cancelled'(server action 守);
--              office_staff / owner / 流程中的 supervisor 推進 status / current_step(server action 守)
--     - DELETE:不開
--   leave_approvals:
--     - SELECT:跟著 leave_requests(open 給 authenticated 即可,UI 自然只顯示能看到的 request)
--     - INSERT:approver_id = auth.uid() 且 role 等於 step_role(綁這關角色)
--     - UPDATE / DELETE:不開(簽核紀錄不可竄改)

alter table public.leave_requests enable row level security;
alter table public.leave_approvals enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('leave_requests','leave_approvals')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------- leave_requests ----------

-- SELECT:本人 / office_staff / owner / 自己在 approval_chain 內的 supervisor
create policy leave_requests_read on public.leave_requests
  for select to authenticated
  using (
    applicant_id = auth.uid()
    or public.current_user_role() in ('office_staff','owner')
    or (
      public.current_user_role() = 'site_supervisor'
      and 'site_supervisor'::public.user_role = any(approval_chain)
    )
  );

-- INSERT:本人(server action 會再守 role 不是 owner / chain 正確)
create policy leave_requests_insert_self on public.leave_requests
  for insert to authenticated
  with check (applicant_id = auth.uid());

-- UPDATE:本人(cancel)+ chain 上對應角色(推進)+ office / owner(行政修正)
create policy leave_requests_update on public.leave_requests
  for update to authenticated
  using (
    applicant_id = auth.uid()
    or public.current_user_role() in ('office_staff','owner')
    or (
      public.current_user_role() = 'site_supervisor'
      and 'site_supervisor'::public.user_role = any(approval_chain)
    )
  )
  with check (
    applicant_id = auth.uid()
    or public.current_user_role() in ('office_staff','owner')
    or (
      public.current_user_role() = 'site_supervisor'
      and 'site_supervisor'::public.user_role = any(approval_chain)
    )
  );

-- 不開 DELETE


-- ---------- leave_approvals ----------

-- SELECT:全 authenticated(個別 request 可見性由 leave_requests RLS 控)
create policy leave_approvals_read on public.leave_approvals
  for select to authenticated using (true);

-- INSERT:approver_id 必須是自己 + 自己 role 等於 step_role
create policy leave_approvals_insert on public.leave_approvals
  for insert to authenticated
  with check (
    approver_id = auth.uid()
    and step_role = public.current_user_role()
  );

-- 不開 UPDATE / DELETE
