-- ==========================================================================
-- Migration 2.17 — login_attempts 表(登入速率限制)
-- ==========================================================================
-- 為什麼:
--   2026-05-11 健檢發現登入沒有速率限制 — 任何人可以對同一 email 無限次試密碼。
--   Supabase auth 本身有底層保護但偏寬鬆,應用層需要更嚴格的 3 次失敗 15 分鐘鎖。
--
-- 設計:
--   每次登入(成功 / 失敗)寫一筆紀錄。loginAction 在送 Supabase 前先查:
--   過去 15 分鐘該 email 有 >= 3 次失敗 → 直接擋,不走 Supabase 驗證。
--   時間視窗滾動,15 分鐘後失敗紀錄自然過期,不用手動清。
--
--   只能由 service-role 讀寫(loginAction 用 createServiceClient);
--   一般使用者不需要看自己的登入紀錄。
--
-- 跑法: Supabase SQL Editor 整份貼上。冪等。
-- ==========================================================================

create table if not exists public.login_attempts (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  attempted_at    timestamptz not null default now(),
  success         boolean not null
);

-- 查詢用:依 email(小寫) + 時間倒序
create index if not exists login_attempts_email_time_idx
  on public.login_attempts(lower(email), attempted_at desc);

-- 清理用:依時間(舊資料定期可刪)
create index if not exists login_attempts_time_idx
  on public.login_attempts(attempted_at desc);

alter table public.login_attempts enable row level security;

-- 不開任何 authenticated policy — RLS 全擋,僅 service-role 可讀寫。
-- 為冪等先 drop 舊 policy(若有跑過舊版本)
do $$
declare
  r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'login_attempts'
  loop
    execute format('drop policy %I on public.login_attempts', r.policyname);
  end loop;
end $$;
