-- ==========================================================================
-- Migration 2.7 — 現場回報 (field_reports)
-- ==========================================================================
-- 用途:
--   現場工人 (field_assistant) 簡單記錄：文字 + 多張照片 + 逐張附註，
--   選一個案場送出。工地主任填日誌時，可以勾選該案場的待整合回報，
--   一鍵把文字 append 進 notes、把照片 push 進 daily_logs.photos。
--
--   照片儲存策略：合併時不複製檔案，只共用同一個 storage path。
--   field_reports row 留著當審計軌跡，狀態翻 pending → merged。
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
-- ==========================================================================

-- enum
do $$ begin
  create type field_report_status as enum ('pending', 'merged', 'archived');
exception when duplicate_object then null; end $$;

-- table
-- POC RLS：所有 authenticated 都能讀寫
-- 正式版 TODO：
--   - field_assistant 只能讀寫自己的 (where author_id = auth.uid())
--   - site_supervisor / owner / office_staff 可讀全部 + merge 動作可寫狀態
--   - merged_into_log_id 寫入限定 site_supervisor / owner（執行合併者）
create table if not exists public.field_reports (
  id                  uuid primary key default gen_random_uuid(),
  case_id             uuid not null references public.cases(id) on delete cascade,
  author_id           uuid references public.profiles(id) on delete set null,
  note                text,
  photos              jsonb not null default '[]'::jsonb,
                      -- [{ path: text, caption: text }]
  status              field_report_status not null default 'pending',
  merged_into_log_id  uuid references public.daily_logs(id) on delete set null,
  merged_by           uuid references public.profiles(id) on delete set null,
  merged_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists field_reports_case_idx on public.field_reports(case_id);
create index if not exists field_reports_status_idx on public.field_reports(status);
create index if not exists field_reports_author_idx on public.field_reports(author_id);
create index if not exists field_reports_created_idx on public.field_reports(created_at desc);

-- updated_at trigger
do $$ begin
  create trigger trg_field_reports_updated_at before update on public.field_reports
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

-- RLS（POC 簡化:authenticated 全開）
alter table public.field_reports enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public'
      and tablename = 'field_reports'
      and policyname = 'poc_authenticated_all'
  loop
    execute format('drop policy %I on public.field_reports', r.policyname);
  end loop;
end $$;

create policy poc_authenticated_all on public.field_reports
  for all to authenticated using (true) with check (true);

-- supabase_auth_admin 需要 introspect 整個 schema
grant usage on type public.field_report_status to supabase_auth_admin;
