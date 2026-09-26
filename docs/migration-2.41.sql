-- ==========================================================================
-- Migration 2.41 — 人事／薪資 Phase B:排班(班別範本 + 班表登記)
-- ==========================================================================
-- 用途:
--   業主要的「排班表登記」。排班是後面兩件事的基準線:
--     - 遲到判定:實際打卡 vs 排定上班時間(Phase C/E)
--     - 季滿勤:排定天數 vs 實到天數(Phase D)
--   餐飲分公司會用到多班別(早 / 午 / 晚、兩頭班),所以班別做成範本表,不寫死。
--
-- 設計:
--   - shift_templates:班別範本(名稱、起訖時間、休息分鐘)。裕民先種一筆「日班 08:00–17:00 休 60 分」。
--     end_time <= start_time 代表跨日(晚班 18:00–02:00),程式端 shiftDurationMinutes() 會處理。
--     不刪只停用(is_active),舊班表還指著它。
--   - schedule_entries:某人某天排什麼班。一天可以多筆(兩頭班),每筆指向一個範本,
--     或用 start_time / end_time 自訂(範本為 null 時兩個時間都要有)。
--     可選綁案件(工地排班),note 自由文字。
--     同一人同一天同一範本 / 同一起始時間不重複(partial unique index)。
--   - RLS:範本所有登入者可讀;班表 本人 + office_staff / owner / site_supervisor 可讀
--     (主任要看工班誰哪天在哪個工地 — 跟主任跨案件的設計一致);
--     寫入只走 service-role(server action 先 requireRole office_staff / owner)。
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. shift_templates
-- --------------------------------------------------------------------------
create table if not exists public.shift_templates (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  -- 顯示在班表格子上的短名(1–2 個字),例如「日」「早」「晚」
  short_name     text not null,
  start_time     time not null,
  end_time       time not null,
  break_minutes  integer not null default 60 check (break_minutes >= 0 and break_minutes <= 240),
  -- 之後多公司各自的班別;null = 所有公司共用
  company        text,
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.shift_templates is
  '班別範本。end_time <= start_time 代表跨日班。不刪只停用。';

do $$ begin
  create trigger trg_shift_templates_updated_at before update on public.shift_templates
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

alter table public.shift_templates enable row level security;

drop policy if exists shift_templates_read on public.shift_templates;
create policy shift_templates_read on public.shift_templates
  for select to authenticated using (true);
-- 寫入只走 service-role

-- 裕民預設班別。重跑不重複種(用名稱判斷)。
insert into public.shift_templates (name, short_name, start_time, end_time, break_minutes, sort_order)
select '日班', '日', '08:00', '17:00', 60, 0
where not exists (select 1 from public.shift_templates where name = '日班');

-- --------------------------------------------------------------------------
-- 2. schedule_entries
-- --------------------------------------------------------------------------
create table if not exists public.schedule_entries (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  work_date          date not null,
  shift_template_id  uuid references public.shift_templates(id) on delete restrict,
  -- 範本為 null 時用這兩個自訂;有範本時可為 null(照範本)
  start_time         time,
  end_time           time,
  case_id            uuid references public.cases(id) on delete set null,
  note               text,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint schedule_entries_shift_or_custom check (
    shift_template_id is not null
    or (start_time is not null and end_time is not null)
  )
);

comment on table public.schedule_entries is
  '班表:某人某天排哪個班(可多筆 = 兩頭班)。範本或自訂時間二擇一。case_id 可空。';

create index if not exists schedule_entries_user_date_idx
  on public.schedule_entries(user_id, work_date);
create index if not exists schedule_entries_date_idx
  on public.schedule_entries(work_date);

-- 同一人同一天同一班別不重複;自訂時間以起始時間判斷
create unique index if not exists schedule_entries_no_dup_idx
  on public.schedule_entries(
    user_id,
    work_date,
    coalesce(shift_template_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(start_time, '00:00'::time)
  );

do $$ begin
  create trigger trg_schedule_entries_updated_at before update on public.schedule_entries
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

alter table public.schedule_entries enable row level security;

drop policy if exists schedule_entries_read on public.schedule_entries;
create policy schedule_entries_read on public.schedule_entries
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_user_role() in ('office_staff', 'owner', 'site_supervisor')
  );
-- 寫入只走 service-role

notify pgrst, 'reload schema';

-- --------------------------------------------------------------------------
-- 自我檢查
-- --------------------------------------------------------------------------
do $$
declare
  n int;
begin
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'shift_templates';
  if n <> 1 then raise exception '自我檢查失敗:shift_templates 應只有 1 條 policy,實際 %', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'schedule_entries';
  if n <> 1 then raise exception '自我檢查失敗:schedule_entries 應只有 1 條 policy,實際 %', n; end if;
  select count(*) into n from public.shift_templates where name = '日班';
  if n <> 1 then raise exception '自我檢查失敗:預設「日班」應恰好 1 筆,實際 %', n; end if;
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'schedule_entries_no_dup_idx'
  ) then
    raise exception '自我檢查失敗:schedule_entries_no_dup_idx 不存在';
  end if;
end $$;

-- 驗證(可自行執行):
--   select name, short_name, start_time, end_time, break_minutes from public.shift_templates order by sort_order;
--   select policyname, cmd from pg_policies where tablename in ('shift_templates','schedule_entries');
