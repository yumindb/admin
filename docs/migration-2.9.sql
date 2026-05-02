-- ==========================================================================
-- Migration 2.9 — 施工日誌送出後再次編輯 + audit trail (daily_log_revisions)
-- ==========================================================================
-- 用途:
--   送出後(status='submitted')或被退回後(status='rejected')允許工地主任本人 /
--   辦公室助理 / 老闆再次編輯日誌內容(typo、補資料等),但每次編輯保留稽核軌跡。
--   approved 不開放編輯。
--
--   每次 post-submission edit 寫一筆 daily_log_revisions:
--     - editor_id / editor_role / edited_at — 誰、什麼角色、什麼時候
--     - log_status_at_edit — 編輯當下的 log status
--     - snapshot — 編輯「前」可變欄位的完整快照(jsonb,方便還原 / forensic)
--     - changed_fields — 變更欄位 key 列表(顯示用,server-side 算好)
--     - reason — 預留欄位,未來想加「編輯原因」可用
--
--   server action 寫入順序:先 select 當前 row 做 snapshot → insert revision →
--   update daily_logs;失敗任何一步整體 reject。
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
-- ==========================================================================

-- table
-- POC RLS:authenticated 都能讀寫
-- 正式版 TODO:
--   - select 跟隨 daily_logs 可見性
--   - insert 限定當前能編輯該 log 的角色(supervisor 自身 / office_staff / owner)
--   - 不允許 update / delete(audit log 不可竄改)
create table if not exists public.daily_log_revisions (
  id                  uuid primary key default gen_random_uuid(),
  log_id              uuid not null references public.daily_logs(id) on delete cascade,
  editor_id           uuid references public.profiles(id) on delete set null,
  editor_role         user_role not null,
  edited_at           timestamptz not null default now(),
  log_status_at_edit  log_status not null,
  snapshot            jsonb not null,
  changed_fields      text[] not null default '{}',
  reason              text
);

create index if not exists daily_log_revisions_log_idx
  on public.daily_log_revisions(log_id);
create index if not exists daily_log_revisions_edited_idx
  on public.daily_log_revisions(edited_at desc);

-- RLS(POC 簡化:authenticated 全開)
alter table public.daily_log_revisions enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public'
      and tablename = 'daily_log_revisions'
      and policyname = 'poc_authenticated_all'
  loop
    execute format('drop policy %I on public.daily_log_revisions', r.policyname);
  end loop;
end $$;

create policy poc_authenticated_all on public.daily_log_revisions
  for all to authenticated using (true) with check (true);
