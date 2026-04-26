-- ==========================================================================
-- Yu Min Admin — POC Phase 1 Schema
-- ==========================================================================
-- 本檔案為 POC 階段 schema。POC 簡化原則：
--   - role 三個固定值：office_staff / site_supervisor / owner
--   - company 暫時 hardcode '裕民'，先保留欄位但不做 UI
--   - RLS：登入 user 都能讀寫；正式版規則寫在每張表上方 TODO
--
-- 使用方式：整份貼進 Supabase SQL Editor 執行（已是冪等寫法）。
-- ==========================================================================

-- 必要 extensions
create extension if not exists "pgcrypto";   -- gen_random_uuid()


-- ==========================================================================
-- ENUMs
-- ==========================================================================

do $$ begin
  create type user_role as enum ('office_staff', 'site_supervisor', 'owner');
exception when duplicate_object then null; end $$;

do $$ begin
  create type case_status as enum ('active', 'paused', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  -- section: 分類層（壹.二.10 機電工程；不可填數量）
  -- item:    工項層（壹.二.10.1.4.24 EMT 管 E19；可填數量／單位／單價）
  -- spec:    規格子項（item 下的尺寸／規格細項，可填數量）
  -- manual:  系統手動補項（不來自標單）
  create type work_item_type as enum ('section', 'item', 'spec', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tender_import_status as enum ('parsed', 'imported', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type log_status as enum ('draft', 'submitted', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  -- POC 只用 'approve' 一關（老闆核定）；正式版會擴增 review / audit / approve 三關
  create type approval_stage as enum ('review', 'audit', 'approve');
exception when duplicate_object then null; end $$;

do $$ begin
  create type approval_decision as enum ('approved', 'rejected');
exception when duplicate_object then null; end $$;


-- ==========================================================================
-- 1. profiles
-- ==========================================================================
-- 對應 auth.users 的 1:1 profile。auth.users 的 id 即 profiles.id。
--
-- POC RLS：所有登入者可讀可寫
-- 正式版 TODO：
--   - 看自己（users select where id = auth.uid()）
--   - admin/owner 看全部
--   - 改自己的 full_name 可，role / company 由 admin 改
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  role        user_role not null default 'office_staff',
  company     text not null default '裕民',  -- POC hardcode；正式版改 multi-company
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles(role);


-- ==========================================================================
-- 2. cases — 案件
-- ==========================================================================
-- POC RLS：所有登入者可讀可寫
-- 正式版 TODO：
--   - site_supervisor 只看自己被指派的案件（assigned_supervisors join 表）
--   - office_staff/owner 看全部
--   - 開新案：office_staff/owner only
create table if not exists public.cases (
  id           uuid primary key default gen_random_uuid(),
  code         text unique,                      -- 案件編號（可空，使用者自填）
  name         text not null,                    -- 案件名稱
  location     text,                             -- 施工地點
  client       text,                             -- 業主／發包單位
  company      text not null default '裕民',     -- POC hardcode
  status       case_status not null default 'active',
  started_at   date,
  expected_end date,
  notes        text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists cases_status_idx on public.cases(status);
create index if not exists cases_company_idx on public.cases(company);


-- ==========================================================================
-- 3. tender_imports — 標單匯入記錄
-- ==========================================================================
-- 每次「匯入 .xlsx」產生一筆，記錄 parse 結果與後續用於合併判斷的 import_id。
--
-- POC RLS：所有登入者可讀可寫
-- 正式版 TODO：
--   - 看自己案件的匯入記錄
--   - file_path 用 signed URL 限制下載
create table if not exists public.tender_imports (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references public.cases(id) on delete cascade,
  file_name       text not null,
  file_path       text,                          -- Supabase Storage 路徑（POC 可空）
  status          tender_import_status not null default 'parsed',
  parse_stats     jsonb not null default '{}'::jsonb,
                  -- e.g. { rows: 38, sections: 4, items: 25, specs: 9, skipped: 0 }
  warnings        jsonb not null default '[]'::jsonb,
                  -- e.g. [{ row: 12, msg: "缺項次編碼" }, ...]
  imported_count  int not null default 0,
  skipped_count   int not null default 0,
  imported_by     uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists tender_imports_case_idx on public.tender_imports(case_id);
create index if not exists tender_imports_created_idx on public.tender_imports(created_at desc);


-- ==========================================================================
-- 4. case_work_items — 案件工項（階層）
-- ==========================================================================
-- 一張表 + 自連結 parent_id + sort_path 維持階層顯示。
-- sort_path 為 zero-padded 字串如 "0001.0002.0003"，用於 ORDER BY 取得正確順序。
-- depth = 0 表 root；隨層級遞增。
-- item_type 區分 section（不可填量）/ item（可填）/ spec（item 下細項，可填）/ manual。
--
-- 重複匯入合併規則（在 server action 層處理）：
--   - 以 (case_id, tender_code, name) 為 dedupe key
--   - 已存在且 modified_by_user = true → skip（保留使用者修改）
--   - 已存在且未修改 → update 數量／單價
--   - 新項 → insert，import_id 指向新 tender_imports
--
-- POC RLS：所有登入者可讀可寫
-- 正式版 TODO：
--   - 跟隨 cases 的可見性（join cases on case_id）
--   - 修改限定 office_staff/owner
create table if not exists public.case_work_items (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid not null references public.cases(id) on delete cascade,
  parent_id          uuid references public.case_work_items(id) on delete cascade,
  sort_path          text not null,              -- e.g. "0001.0002.0010.0001"
  depth              int not null default 0,
  item_type          work_item_type not null,
  tender_code        text,                       -- e.g. "壹.二.10.1.4.24"
  name               text not null,
  unit               text,                       -- M / 式 / 組 / 只 ...
  quantity           numeric(14, 3),
  unit_price         numeric(14, 2),
  total_price        numeric(14, 2),             -- 複價（標單原欄）
  brand_note         text,                       -- 編碼(備註)欄，e.g. "永銳堅 允泰 樺晟"
  spec_text          text,                       -- 多行 spec / 規格描述（保留 \n）
  skipped            boolean not null default false,  -- 使用者勾「略過」
  modified_by_user   boolean not null default false,  -- 重複匯入不覆蓋
  import_id          uuid references public.tender_imports(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists case_work_items_case_idx on public.case_work_items(case_id);
create index if not exists case_work_items_parent_idx on public.case_work_items(parent_id);
create index if not exists case_work_items_sort_idx on public.case_work_items(case_id, sort_path);
create index if not exists case_work_items_dedupe_idx
  on public.case_work_items(case_id, tender_code, name);


-- ==========================================================================
-- 5. daily_logs — 施工日誌（Phase 1 預留結構，1A 不會填資料）
-- ==========================================================================
-- POC RLS：所有登入者可讀可寫
-- 正式版 TODO：
--   - supervisor 只能讀寫自己 case 的 draft/rejected
--   - 其他角色看全部
--   - submitted 後 supervisor 不能改
create table if not exists public.daily_logs (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references public.cases(id) on delete restrict,
  supervisor_id   uuid references public.profiles(id) on delete set null,
  log_date        date not null,
  weather         text,
  manpower        jsonb not null default '{}'::jsonb,
                  -- e.g. { 自有: 5, 統包: 3, 工種: { 鐵工: 2, 水電: 1 } }
  work_items      jsonb not null default '[]'::jsonb,
                  -- e.g. [{ work_item_id: uuid, qty: 10, note: "..." }]
  photos          jsonb not null default '[]'::jsonb,
  notes           text,
  status          log_status not null default 'draft',
  submitted_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists daily_logs_case_idx on public.daily_logs(case_id);
create index if not exists daily_logs_status_idx on public.daily_logs(status);
create index if not exists daily_logs_date_idx on public.daily_logs(log_date desc);


-- ==========================================================================
-- 6. log_approvals — 簽核記錄（Phase 1 預留結構）
-- ==========================================================================
-- POC RLS：所有登入者可讀可寫
-- 正式版 TODO：
--   - 跟隨 daily_logs 可見性
--   - 寫入限定對應 stage 的角色（review→site_supervisor, audit→office_staff, approve→owner）
create table if not exists public.log_approvals (
  id              uuid primary key default gen_random_uuid(),
  log_id          uuid not null references public.daily_logs(id) on delete cascade,
  stage           approval_stage not null,
  approver_id     uuid references public.profiles(id) on delete set null,
  decision        approval_decision not null,
  comment         text,
  signature_url   text,
  created_at      timestamptz not null default now()
);

create index if not exists log_approvals_log_idx on public.log_approvals(log_id);


-- ==========================================================================
-- updated_at 自動更新 trigger
-- ==========================================================================
create or replace function public.touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

do $$ begin
  create trigger trg_profiles_updated_at before update on public.profiles
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_cases_updated_at before update on public.cases
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_case_work_items_updated_at before update on public.case_work_items
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_daily_logs_updated_at before update on public.daily_logs
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;


-- ==========================================================================
-- RLS — POC 簡化版：所有 authenticated 都能讀寫
-- ==========================================================================
-- ⚠ 正式版 TODO：照每張表上方註解寫的規則重做。

alter table public.profiles         enable row level security;
alter table public.cases            enable row level security;
alter table public.tender_imports   enable row level security;
alter table public.case_work_items  enable row level security;
alter table public.daily_logs       enable row level security;
alter table public.log_approvals    enable row level security;

-- 為了冪等：先 drop 再 create
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles','cases','tender_imports','case_work_items','daily_logs','log_approvals')
      and policyname = 'poc_authenticated_all'
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create policy poc_authenticated_all on public.profiles
  for all to authenticated using (true) with check (true);
create policy poc_authenticated_all on public.cases
  for all to authenticated using (true) with check (true);
create policy poc_authenticated_all on public.tender_imports
  for all to authenticated using (true) with check (true);
create policy poc_authenticated_all on public.case_work_items
  for all to authenticated using (true) with check (true);
create policy poc_authenticated_all on public.daily_logs
  for all to authenticated using (true) with check (true);
create policy poc_authenticated_all on public.log_approvals
  for all to authenticated using (true) with check (true);


-- ==========================================================================
-- auth.users → profiles 自動建立 trigger
-- ==========================================================================
-- 用 Supabase Dashboard 建帳號時，會自動在 profiles 補一筆。
-- raw_user_meta_data 可帶 full_name / role，否則用 email 前綴 + 預設 office_staff。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(meta->>'full_name', split_part(new.email, '@', 1)),
    coalesce((meta->>'role')::user_role, 'office_staff')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
