-- ==========================================================================
-- Migration 2.40 — 人事／薪資 Phase A:員工薪制檔案、假日行事曆、薪資規則設定
-- ==========================================================================
-- 用途:
--   2026-09 業主要做人事系統(排班、正職月薪 / 日薪人員的薪資計算、季獎金、遲到扣款),
--   而且「後台要能彈性設定,之後可能給其他餐飲服務業的分公司用」。這支是第一階段,
--   只放「資料」不放「計算」:
--     1. profiles.can_manage_payroll — 老闆授權哪些辦公室助理可以看薪資金額 / 做月結
--     2. has_payroll_access() — RLS 用的 helper:owner 或「被授權的 office_staff」
--     3. employee_pay_profiles — 每個員工的薪制(月薪 / 日薪 + 金額 + 生效日),append-only
--     4. holidays — 國定假日 / 補班日行事曆(判定假日倍率與季滿勤天數用)
--     5. app_settings 種入 payroll.* 六組規則預設值(勞基法一例一休的倍率)
--
-- 設計:
--   - 薪資金額**不放 profiles**:profiles 是全員可讀(主任跨案件設計),放進去等於
--     工人看得到全公司薪水。獨立表 + 獨立 policy 才鎖得住。
--   - employee_pay_profiles 是 **append-only 版本化**:調薪 = 新增一列新的 effective_from,
--     不改舊列;算某月薪水時取該月生效的那列,追溯才會對。沒有 UPDATE / DELETE policy,
--     寫入只走 service-role(server action 內先 requirePayrollAccess())。
--   - 權限分兩層(2026-09-26 Evelyn 拍板):
--       規則設定(倍率、天數、開關)= office_staff 以上;
--       薪資金額、月結、薪資單     = owner + 老闆在 /staff 勾「可處理薪資」的助理。
--     這樣裕民現在可以只有老闆看得到金額,餐飲分公司之後可以把會計勾起來,不用改程式。
--   - holidays 只放「實際放假的平日」(國定假日落在週六日時,放的是補假那天);
--     週六 / 週日本來就是休息日 / 例假日,由 payroll.overtime 設定決定。
--   - 規則放 app_settings(migration-2.34 的 key-value 表):value 是 jsonb,
--     程式端(lib/payroll/settings.ts)用 zod 補預設值 — 設定讀不到 / 缺欄位一律回預設,
--     所以就算這支的種子沒跑,程式也不會壞。
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
--
-- ✅ 執行狀態:**production(ref sgeuznnfasrgxlsqzxpc)已於 2026-09-26 執行完畢**
--    (Supabase MCP apply_migration,Evelyn 授權;先乾跑 rollback 一次,自我檢查通過)。
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. profiles.can_manage_payroll
-- --------------------------------------------------------------------------
alter table public.profiles
  add column if not exists can_manage_payroll boolean not null default false;

comment on column public.profiles.can_manage_payroll is
  '老闆授權此帳號(限辦公室助理)可以看薪資金額、做月結。owner 不用這個旗標,天生就有。';

-- --------------------------------------------------------------------------
-- 2. has_payroll_access():owner,或被授權且啟用中的 office_staff
--    跟 current_user_role() 同模式:security definer + 鎖 search_path + 只給 authenticated
-- --------------------------------------------------------------------------
create or replace function public.has_payroll_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid()
       and is_active
       and (role = 'owner' or (role = 'office_staff' and can_manage_payroll))
  )
$$;
revoke execute on function public.has_payroll_access() from public, anon;
grant execute on function public.has_payroll_access() to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 3. employee_pay_profiles(append-only)
-- --------------------------------------------------------------------------
create table if not exists public.employee_pay_profiles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  -- monthly = 正職月薪;daily = 日薪
  employment_type  text not null check (employment_type in ('monthly', 'daily')),
  -- 月薪人員 = 月薪;日薪人員 = 日薪。整數新台幣。
  amount           integer not null check (amount >= 0),
  effective_from   date not null,
  note             text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

comment on table public.employee_pay_profiles is
  '員工薪制,append-only:調薪新增一列(新的 effective_from),舊列保留當歷史。某日生效的薪制 = effective_from <= 該日 中最晚的一列(同日取 created_at 最新)。';

create index if not exists employee_pay_profiles_user_idx
  on public.employee_pay_profiles(user_id, effective_from desc, created_at desc);

alter table public.employee_pay_profiles enable row level security;

drop policy if exists pay_profiles_read on public.employee_pay_profiles;
create policy pay_profiles_read on public.employee_pay_profiles
  for select to authenticated
  using (user_id = auth.uid() or public.has_payroll_access());
-- 不開 INSERT / UPDATE / DELETE:寫入只走 service-role(server action 先驗 requirePayrollAccess)

-- 萬一 service-role 端動了舊列(不該發生),留 audit
do $$ begin
  create trigger trg_employee_pay_profiles_audit
    after update or delete on public.employee_pay_profiles
    for each row execute function public.audit_trigger_fn();
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------------
-- 4. holidays
-- --------------------------------------------------------------------------
create table if not exists public.holidays (
  holiday_date  date primary key,
  name          text not null,
  -- true = 補班日(這天雖是週六日但要上班,算平日);false = 放假
  is_workday    boolean not null default false,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.holidays is
  '國定假日 / 補假 / 補班日。只放「實際放假的那一天」(假日落在週六日時放補假日)。辦公室每年維護一次。';

alter table public.holidays enable row level security;

drop policy if exists holidays_read on public.holidays;
create policy holidays_read on public.holidays
  for select to authenticated using (true);
-- 寫入只走 service-role(server action 先 requireRole office_staff / owner)

-- 115 年(2026)行事曆,依人事行政總處公告整理;辦公室助理請在「薪資 → 假日行事曆」核對。
-- 只列平日(週一到週五)放假的日子。重跑不會覆蓋助理改過的。
insert into public.holidays (holiday_date, name) values
  ('2026-01-01', '開國紀念日（元旦）'),
  ('2026-01-02', '元旦調整放假'),
  ('2026-02-16', '農曆除夕'),
  ('2026-02-17', '春節（初一）'),
  ('2026-02-18', '春節（初二）'),
  ('2026-02-19', '春節（初三）'),
  ('2026-02-20', '春節調整放假'),
  ('2026-02-27', '和平紀念日補假'),
  ('2026-04-03', '兒童節補假'),
  ('2026-04-06', '清明節補假'),
  ('2026-05-01', '勞動節'),
  ('2026-06-19', '端午節'),
  ('2026-09-25', '中秋節'),
  ('2026-09-28', '教師節'),
  ('2026-10-09', '國慶日補假'),
  ('2026-10-26', '光復節補假'),
  ('2026-12-25', '行憲紀念日')
on conflict (holiday_date) do nothing;

-- --------------------------------------------------------------------------
-- 5. 薪資規則預設值(app_settings)
--    值的結構以 lib/payroll/settings.ts 的 zod schema 為準;這裡的 JSON 只是
--    讓 DB 自我描述 + 讓設定頁第一次打開就有東西。缺 key / 缺欄位程式都會補預設。
--    on conflict do nothing → 重跑不會把助理改過的設定蓋掉。
-- --------------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('payroll.work_rules',
   '{"daily_hours": 8, "weekly_days": 5, "monthly_divisor_days": 30, "auto_break_after_hours": 6, "auto_break_minutes": 60, "ot_unit_minutes": 1, "monthly_ot_cap_hours": 46}',
   '工時基本規則:每日正常工時、每週工作日數、月薪換時薪的除數(月薪÷30÷8)、自動扣休息、加班計算單位(分)、每月加班上限(只警告不擋)'),
  ('payroll.overtime',
   '{"weekday_tiers": [{"hours": 2, "multiplier": 1.34}, {"hours": 2, "multiplier": 1.67}], "rest_day_tiers": [{"hours": 2, "multiplier": 1.34}, {"hours": 6, "multiplier": 1.67}, {"hours": 4, "multiplier": 2.67}], "holiday_multiplier": 2, "rest_day_weekday": 6, "regular_off_weekday": 7}',
   '加班倍率(勞基法一例一休預設):平日前 2 小時 ×1.34、再 2 小時 ×1.67;休息日(週六)前 2 小時 ×1.34、第 3–8 小時 ×1.67、第 9–12 小時 ×2.67;國定假日 / 例假日(週日)出勤 ×2'),
  ('payroll.late',
   '{"enabled": false, "grace_minutes": 10, "mode": "per_minute", "fixed_amount": 0}',
   '遲到扣款:預設關閉(裕民不扣)。開啟後超過寬限分鐘才算遲到;per_minute = 依時薪按分鐘扣,fixed = 每次扣固定金額'),
  ('payroll.leave_pay_ratios',
   '{"personal": 0, "sick": 0.5, "official": 1, "annual": 1, "menstrual": 0.5, "bereavement": 1, "marriage": 1, "other": 0}',
   '各假別給薪比例(月薪人員請假扣薪用):事假 0、病假 0.5、特休 / 公假 / 婚假 / 喪假 1、生理假 0.5、其他 0'),
  ('payroll.bonus',
   '{"enabled": true, "per_day_amount": 200, "required_days_per_quarter": 60, "counted_leave_types": ["annual", "official"], "payout_month_offset": 2, "quarter_overrides": {}, "eligible_employment_types": ["monthly", "daily"]}',
   '季績效獎金:該季出勤天數達門檻(預設 60 天,可依季覆寫如 2026-Q1)→ 出勤天數 × 每日金額;特休、公假視同出勤;季末後第 2 個月隨薪資發(Q1 → 6 月)'),
  ('payroll.payday',
   '{"day_of_month": 5}',
   '發薪日:每月幾號發上個月薪資(季獎金也跟著這天)')
on conflict (key) do nothing;

notify pgrst, 'reload schema';

-- --------------------------------------------------------------------------
-- 自我檢查:任一不符就整筆 rollback
-- --------------------------------------------------------------------------
do $$
declare
  n int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'can_manage_payroll'
  ) then
    raise exception '自我檢查失敗:profiles.can_manage_payroll 不存在';
  end if;

  if not has_function_privilege('authenticated', 'public.has_payroll_access()', 'EXECUTE') then
    raise exception '自我檢查失敗:authenticated 不能執行 has_payroll_access()(RLS 會壞)';
  end if;
  if has_function_privilege('anon', 'public.has_payroll_access()', 'EXECUTE') then
    raise exception '自我檢查失敗:anon 仍可執行 has_payroll_access()';
  end if;

  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'employee_pay_profiles';
  if n <> 1 then
    raise exception '自我檢查失敗:employee_pay_profiles 應只有 1 條 policy(read),實際 %', n;
  end if;

  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'holidays';
  if n <> 1 then
    raise exception '自我檢查失敗:holidays 應只有 1 條 policy(read),實際 %', n;
  end if;

  select count(*) into n from public.app_settings where key like 'payroll.%';
  if n < 6 then
    raise exception '自我檢查失敗:app_settings 的 payroll.* 應有 6 組,實際 %', n;
  end if;
end $$;

-- 驗證(可自行執行):
--   select key, description from public.app_settings where key like 'payroll.%' order by key;
--   select holiday_date, name from public.holidays order by 1;
--   select policyname, cmd from pg_policies where tablename in ('employee_pay_profiles','holidays');
