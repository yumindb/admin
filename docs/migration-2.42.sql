-- ==========================================================================
-- Migration 2.42 — 排休(day_off_requests)+ 班表稽核 trigger + 排休設定
-- ==========================================================================
-- 用途:
--   員工在班表排出來**之前**先標「這幾天我不能上」,排班的人看著標記排。
--   跟請假是兩回事:排休是給排班者的提醒(不簽核、不影響薪資);請假是班表已排、事後不能來
--   (走 leave_requests 簽核鏈)。2026-09-26 Evelyn 拍板:不用核准、裕民也開。
--
-- 設計:
--   - day_off_requests:一人一天一列(PK),note 選填。本人可寫可刪自己的;
--     office_staff / owner / site_supervisor 可讀全部(排班用)。
--     不做狀態、不做簽核。已經排了班的日子不能標(程式端擋,提示走請假)。
--   - 每月上限 / 截止日放 app_settings 的 payroll.day_off(預設都不限制;餐飲分公司可設)。
--   - 順手補 schedule_entries 的 audit trigger(誰改了誰的班、改前長什麼樣)。
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
--
-- ✅ 執行狀態:**production(ref sgeuznnfasrgxlsqzxpc)已於 2026-09-26 執行完畢**
--    (Supabase MCP apply_migration,Evelyn 授權;先乾跑 rollback 一次,自我檢查通過)。
-- ==========================================================================

create table if not exists public.day_off_requests (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  off_date    date not null,
  note        text,
  created_at  timestamptz not null default now(),
  primary key (user_id, off_date)
);

comment on table public.day_off_requests is
  '排休:員工在排班前標「這天不能上」。不簽核,只是給排班者的提醒;真正的決定權在排班的人。';

create index if not exists day_off_requests_date_idx on public.day_off_requests(off_date);

alter table public.day_off_requests enable row level security;

drop policy if exists day_off_read on public.day_off_requests;
create policy day_off_read on public.day_off_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_user_role() in ('office_staff', 'owner', 'site_supervisor')
  );

-- 本人寫 / 刪自己的(server action 再守「不能標已排班的日子」「上限」「截止日」)
drop policy if exists day_off_insert_own on public.day_off_requests;
create policy day_off_insert_own on public.day_off_requests
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists day_off_delete_own on public.day_off_requests;
create policy day_off_delete_own on public.day_off_requests
  for delete to authenticated
  using (user_id = auth.uid());

-- 班表稽核:排班是薪資的基準線,誰改了要留底
do $$ begin
  create trigger trg_schedule_entries_audit
    after update or delete on public.schedule_entries
    for each row execute function public.audit_trigger_fn();
exception when duplicate_object then null; end $$;

-- 排休設定(結構見 lib/payroll/settings.ts DayOffSchema)
insert into public.app_settings (key, value, description) values
  ('payroll.day_off',
   '{"enabled": true, "monthly_cap": 0, "deadline_day": 0, "min_days_ahead": 1}',
   '排休:是否開放員工標排休、每月上限(0 = 不限)、截止日(0 = 不限;例如 20 = 每月 20 號前標下個月)、至少提前幾天')
on conflict (key) do nothing;

notify pgrst, 'reload schema';

do $$
declare n int;
begin
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'day_off_requests';
  if n <> 3 then raise exception '自我檢查失敗:day_off_requests 應有 3 條 policy,實際 %', n; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_schedule_entries_audit') then
    raise exception '自我檢查失敗:trg_schedule_entries_audit 不存在';
  end if;
  if not exists (select 1 from public.app_settings where key = 'payroll.day_off') then
    raise exception '自我檢查失敗:payroll.day_off 設定不存在';
  end if;
end $$;
