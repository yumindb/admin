-- ==========================================================================
-- Migration 2.30 — 儀表板警示「先不理」(dashboard_dismissals)
-- ==========================================================================
-- 用途:
--   老闆儀表板「需要您出手」是即時算出來的(退回未重送 / 案件停滯),
--   知道了但還不想處理時會一直卡在畫面上。這張表讓每個人各自把單一項
--   暫時收起來。
--
--   為什麼是「暫時」(dismissed_until)而不是永久:
--     這兩種警示代表真的有東西卡住(日誌沒重送、案件沒人填)。永久隱藏
--     等於把問題藏起來 — 時間到會自動再冒出來提醒。預設 7 天。
--     案件如果是「真的暫停施工」,正解是把案件狀態改成「暫停中」,
--     那樣本來就不會列入停滯統計。
--
--   per-user:每個人管自己的儀表板,老闆忽略不影響辦公室助理。
--
--   target_id 不設 FK:警示對象跨 daily_logs / cases 兩張表,
--   而且對象被刪掉時這筆紀錄本來就該失效(查詢時 join 不到自然不顯示)。
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
-- ==========================================================================

create table if not exists public.dashboard_dismissals (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  alert_kind      text not null check (alert_kind in ('rejected', 'stale')),
  target_id       uuid not null,
  dismissed_until timestamptz not null,
  created_at      timestamptz not null default now(),
  unique (profile_id, alert_kind, target_id)
);

create index if not exists dashboard_dismissals_lookup_idx
  on public.dashboard_dismissals(profile_id, dismissed_until desc);

-- ==========================================================================
-- RLS — 只能讀寫自己的
-- ==========================================================================
alter table public.dashboard_dismissals enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'dashboard_dismissals'
  loop
    execute format('drop policy %I on public.dashboard_dismissals', r.policyname);
  end loop;
end $$;

create policy dismissals_select_own on public.dashboard_dismissals
  for select to authenticated using (profile_id = auth.uid());

create policy dismissals_insert_own on public.dashboard_dismissals
  for insert to authenticated with check (profile_id = auth.uid());

create policy dismissals_update_own on public.dashboard_dismissals
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy dismissals_delete_own on public.dashboard_dismissals
  for delete to authenticated using (profile_id = auth.uid());

-- 通知 PostgREST 重整 schema cache
notify pgrst, 'reload schema';

-- 驗證
select policyname, cmd from pg_policies
  where schemaname = 'public' and tablename = 'dashboard_dismissals'
  order by policyname;
