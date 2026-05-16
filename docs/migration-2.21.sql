-- ==========================================================================
-- Migration 2.21 — 打卡事件 (attendance_events)
-- ==========================================================================
-- 用途:
--   工地主任 / 現場助理「上班 / 下班打卡」事件流。每次打卡寫一筆 row,
--   包含 GPS 座標、精度、與案件 geofence 距離、是否在範圍內。
--
--   case_id 允許 null(在公司 / 跨工地移動 / 案件無座標時);
--   note 在 case_id is null 時應該必填(由 server action 邏輯層擋,DB 不擋,
--   避免日後流程改動要動 schema)。
--
--   軟警告政策:within_geofence = false 仍接受寫入,只是 UI / 報表會標註。
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
-- ==========================================================================

create table if not exists public.attendance_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  case_id         uuid references public.cases(id) on delete set null,
  event_type      text not null check (event_type in ('clock_in','clock_out')),
  lat             numeric(9,6) not null check (lat >= -90 and lat <= 90),
  lng             numeric(9,6) not null check (lng >= -180 and lng <= 180),
  accuracy_m      numeric(8,2),                -- 瀏覽器回報的 GPS 精度(可空,有些舊瀏覽器不給)
  distance_m      numeric(10,2),               -- 到 case 座標的距離;case 無座標時 null
  within_geofence boolean,                     -- 是否在 radius 內;case 無座標時 null
  source          text not null default 'web' check (source in ('web','liff')),
  user_agent      text,
  note            text,
  created_at      timestamptz not null default now()
);

-- 常用 index:
--   - 個人歷史:user + 時間倒序
--   - 案件出勤:case + 時間倒序
--   - 「今天誰在工地」報表:created_at + case
create index if not exists attendance_events_user_created_idx
  on public.attendance_events(user_id, created_at desc);

create index if not exists attendance_events_case_created_idx
  on public.attendance_events(case_id, created_at desc);

create index if not exists attendance_events_created_idx
  on public.attendance_events(created_at desc);


-- ==========================================================================
-- RLS
-- ==========================================================================
-- 政策:
--   - 任何 authenticated user 可 read all(主任跨案件、office 看報表都需要)
--   - INSERT 只能寫自己 user_id 的 row(避免代打卡)
--   - UPDATE / DELETE 禁止(打卡是 immutable 證據;要修錯只能 INSERT 新事件)
--
-- 與 2026-05-11 supervisor cross-case 決策一致:read-all 是設計而非漏洞。

alter table public.attendance_events enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'attendance_events'
  loop
    execute format('drop policy %I on public.attendance_events', r.policyname);
  end loop;
end $$;

create policy attendance_read_all on public.attendance_events
  for select to authenticated using (true);

create policy attendance_insert_own on public.attendance_events
  for insert to authenticated
  with check (user_id = auth.uid());

-- 明確不開 UPDATE / DELETE policy → 預設拒絕(authenticated 無法改/刪)
