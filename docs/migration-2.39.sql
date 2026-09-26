-- ==========================================================================
-- Migration 2.39 — 系統監控:request_logs(頁面/操作耗時)+ error_logs(錯誤紀錄)
-- ==========================================================================
-- 為什麼:
--   Evelyn 要一組跟 OKB 內部系統一樣的管理頁:登入紀錄、常用操作、慢請求、錯誤紀錄。
--   登入紀錄已有(login_attempts,migration-2.17/2.25)。另外三頁需要:
--     - 每次頁面瀏覽 / server action 的「誰、哪一頁 / 哪個操作、花多久、有沒有出錯」
--     - 伺服器錯誤、瀏覽器端錯誤、資料庫錯誤的明細
--   Vercel Hobby 的 runtime log 只留很短、也無法彙總,所以自己記在 DB。
--
-- 寫入方式(程式在 lib/monitor/):
--   - request_logs:getActor()/tryGetActor() 第一次被呼叫時用 after() 在回應送完後寫,
--     不增加使用者等待時間。prefetch、/api/* 不記。
--   - error_logs:instrumentation.ts 的 onRequestError(伺服器)、wrapDbError(資料庫)、
--     /api/monitor/client-error(瀏覽器)
--   兩張表都只有 service role 能讀寫(RLS 開、不開任何 policy),管理頁先驗角色再用 service client。
--
-- 量體估算:~25 位使用者,每天約 500–2,000 筆 request_logs,retention 90 天
--   → 最多約 18 萬筆、30–50 MB。error_logs 正常情況每天個位數。
--   retention 由 nightly cron 清(lib/retention.ts)。
--
-- 順帶:第 4 節是同一次健檢找到的 4 條效能索引(日誌 / 簽核紀錄 / 工項),與監控無關但一起跑。
--
-- 跑法:Supabase SQL Editor 整份貼上執行。冪等,可重跑。
--   沒跑之前程式照常運作,只是監控頁顯示「尚未啟用」、紀錄寫不進去(會靜默略過)。
-- ==========================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. request_logs
-- --------------------------------------------------------------------------
create table if not exists public.request_logs (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  request_id   uuid,
  user_id      uuid references public.profiles(id) on delete set null,
  role         text,
  -- page = 直接開網址 / 重新整理;nav = 站內點連結(RSC);action = 按鈕送出(server action)
  kind         text not null check (kind in ('page', 'nav', 'action')),
  route        text not null,          -- 正規化後的路由,例 /logs/[id]
  path         text,                   -- 實際路徑(不含 query)
  action_name  text,                   -- server action 的 export 名稱(kind = action)
  duration_ms  integer not null check (duration_ms >= 0),
  status       text not null default 'ok' check (status in ('ok', 'error')),
  cold_start   boolean not null default false,  -- 該台伺服器開機後第一個請求(Vercel 冷啟動)
  device       text
);

create index if not exists request_logs_time_idx
  on public.request_logs (occurred_at desc);
create index if not exists request_logs_user_time_idx
  on public.request_logs (user_id, occurred_at desc);
-- 慢請求清單:只索引 ≥ 1 秒的(正常請求不佔索引空間)
create index if not exists request_logs_slow_idx
  on public.request_logs (duration_ms desc, occurred_at desc)
  where duration_ms >= 1000;

alter table public.request_logs enable row level security;
revoke all on public.request_logs from anon, authenticated;

-- --------------------------------------------------------------------------
-- 2. error_logs
-- --------------------------------------------------------------------------
create table if not exists public.error_logs (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  -- server = 伺服器處理頁面 / 操作時丟出的錯誤;db = 資料庫操作失敗(wrapDbError);client = 使用者瀏覽器
  source       text not null check (source in ('server', 'db', 'client')),
  level        text not null default 'error' check (level in ('error', 'warn')),
  fingerprint  text not null,          -- 同類錯誤分組(來源 + 正規化訊息 + 路由 的 hash)
  message      text not null,
  detail       text,                   -- 內部細節:DB 原始錯誤、cause、Next 路由檔路徑
  digest       text,                   -- 使用者畫面上看到的「錯誤代碼」
  stack        text,
  route        text,
  path         text,
  route_type   text,                   -- server: render/action/route/proxy;client: boundary/global/window/promise
  action_name  text,
  request_id   uuid,
  user_id      uuid references public.profiles(id) on delete set null,
  role         text,
  user_agent   text
);

create index if not exists error_logs_time_idx
  on public.error_logs (occurred_at desc);
create index if not exists error_logs_fingerprint_idx
  on public.error_logs (fingerprint, occurred_at desc);
create index if not exists error_logs_user_time_idx
  on public.error_logs (user_id, occurred_at desc);

alter table public.error_logs enable row level security;
revoke all on public.error_logs from anon, authenticated;

-- --------------------------------------------------------------------------
-- 3. 彙總 function(管理頁用;PostgREST 單次最多回 1000 筆,彙總一定要在 DB 做)
--    全部 SECURITY INVOKER、只給 service_role 執行
-- --------------------------------------------------------------------------

-- 各頁面(依路由)/ 各操作(依 action 名稱,route = 最常從哪一頁按)的次數、人數、耗時分布
create or replace function public.monitor_request_stats(p_since timestamptz, p_slow_ms integer default 2000)
returns table (
  kind         text,
  route        text,
  action_name  text,
  calls        bigint,
  users        bigint,
  errors       bigint,
  slow         bigint,
  cold         bigint,
  avg_ms       integer,
  p50_ms       integer,
  p95_ms       integer,
  max_ms       integer,
  last_at      timestamptz
)
language sql
stable
set search_path = ''
as $$
  select
    'view'::text as kind,
    r.route,
    null::text as action_name,
    count(*) as calls,
    count(distinct r.user_id) as users,
    count(*) filter (where r.status = 'error') as errors,
    count(*) filter (where r.duration_ms >= p_slow_ms) as slow,
    count(*) filter (where r.cold_start) as cold,
    round(avg(r.duration_ms))::integer as avg_ms,
    (percentile_cont(0.5) within group (order by r.duration_ms))::integer as p50_ms,
    (percentile_cont(0.95) within group (order by r.duration_ms))::integer as p95_ms,
    max(r.duration_ms) as max_ms,
    max(r.occurred_at) as last_at
  from public.request_logs r
  where r.occurred_at >= p_since and r.kind <> 'action'
  group by r.route
  union all
  select
    'action'::text as kind,
    mode() within group (order by r.route) as route,
    r.action_name,
    count(*) as calls,
    count(distinct r.user_id) as users,
    count(*) filter (where r.status = 'error') as errors,
    count(*) filter (where r.duration_ms >= p_slow_ms) as slow,
    count(*) filter (where r.cold_start) as cold,
    round(avg(r.duration_ms))::integer as avg_ms,
    (percentile_cont(0.5) within group (order by r.duration_ms))::integer as p50_ms,
    (percentile_cont(0.95) within group (order by r.duration_ms))::integer as p95_ms,
    max(r.duration_ms) as max_ms,
    max(r.occurred_at) as last_at
  from public.request_logs r
  where r.occurred_at >= p_since and r.kind = 'action'
  group by r.action_name
$$;

-- 整體耗時分布(慢請求頁的總覽數字)
create or replace function public.monitor_overall_stats(p_since timestamptz, p_slow_ms integer default 2000)
returns table (
  calls   bigint,
  users   bigint,
  slow    bigint,
  errors  bigint,
  cold    bigint,
  p50_ms  integer,
  p95_ms  integer,
  max_ms  integer
)
language sql
stable
set search_path = ''
as $$
  select
    count(*) as calls,
    count(distinct r.user_id) as users,
    count(*) filter (where r.duration_ms >= p_slow_ms) as slow,
    count(*) filter (where r.status = 'error') as errors,
    count(*) filter (where r.cold_start) as cold,
    coalesce((percentile_cont(0.5) within group (order by r.duration_ms))::integer, 0) as p50_ms,
    coalesce((percentile_cont(0.95) within group (order by r.duration_ms))::integer, 0) as p95_ms,
    coalesce(max(r.duration_ms), 0) as max_ms
  from public.request_logs r
  where r.occurred_at >= p_since
$$;

-- 每人使用量
create or replace function public.monitor_user_stats(p_since timestamptz)
returns table (
  user_id  uuid,
  views    bigint,
  actions  bigint,
  errors   bigint,
  last_at  timestamptz
)
language sql
stable
set search_path = ''
as $$
  select
    r.user_id,
    count(*) filter (where r.kind <> 'action') as views,
    count(*) filter (where r.kind = 'action') as actions,
    count(*) filter (where r.status = 'error') as errors,
    max(r.occurred_at) as last_at
  from public.request_logs r
  where r.occurred_at >= p_since and r.user_id is not null
  group by r.user_id
$$;

-- 每日趨勢(台北日期)
create or replace function public.monitor_daily_counts(p_since timestamptz, p_slow_ms integer default 2000)
returns table (
  day      date,
  views    bigint,
  actions  bigint,
  users    bigint,
  slow     bigint,
  errors   bigint
)
language sql
stable
set search_path = ''
as $$
  select
    (r.occurred_at at time zone 'Asia/Taipei')::date as day,
    count(*) filter (where r.kind <> 'action') as views,
    count(*) filter (where r.kind = 'action') as actions,
    count(distinct r.user_id) as users,
    count(*) filter (where r.duration_ms >= p_slow_ms) as slow,
    count(*) filter (where r.status = 'error') as errors
  from public.request_logs r
  where r.occurred_at >= p_since
  group by 1
  order by 1
$$;

-- 錯誤分組
create or replace function public.monitor_error_groups(p_since timestamptz)
returns table (
  fingerprint    text,
  source         text,
  level          text,
  message        text,
  route          text,
  occurrences    bigint,
  users          bigint,
  first_at       timestamptz,
  last_at        timestamptz,
  first_ever_at  timestamptz
)
language sql
stable
set search_path = ''
as $$
  select
    e.fingerprint,
    (array_agg(e.source order by e.occurred_at desc))[1] as source,
    (array_agg(e.level order by e.occurred_at desc))[1] as level,
    (array_agg(e.message order by e.occurred_at desc))[1] as message,
    (array_agg(e.route order by e.occurred_at desc))[1] as route,
    count(*) as occurrences,
    count(distinct e.user_id) as users,
    min(e.occurred_at) as first_at,
    max(e.occurred_at) as last_at,
    (select min(x.occurred_at) from public.error_logs x where x.fingerprint = e.fingerprint) as first_ever_at
  from public.error_logs e
  where e.occurred_at >= p_since
  group by e.fingerprint
$$;

-- 每日錯誤數(台北日期)
create or replace function public.monitor_error_daily(p_since timestamptz)
returns table (
  day      date,
  errors   bigint,
  warns    bigint,
  users    bigint
)
language sql
stable
set search_path = ''
as $$
  select
    (e.occurred_at at time zone 'Asia/Taipei')::date as day,
    count(*) filter (where e.level = 'error') as errors,
    count(*) filter (where e.level = 'warn') as warns,
    count(distinct e.user_id) as users
  from public.error_logs e
  where e.occurred_at >= p_since
  group by 1
  order by 1
$$;

revoke execute on function public.monitor_request_stats(timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.monitor_overall_stats(timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.monitor_user_stats(timestamptz) from public, anon, authenticated;
revoke execute on function public.monitor_daily_counts(timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.monitor_error_groups(timestamptz) from public, anon, authenticated;
revoke execute on function public.monitor_error_daily(timestamptz) from public, anon, authenticated;
grant execute on function public.monitor_request_stats(timestamptz, integer) to service_role;
grant execute on function public.monitor_overall_stats(timestamptz, integer) to service_role;
grant execute on function public.monitor_user_stats(timestamptz) to service_role;
grant execute on function public.monitor_daily_counts(timestamptz, integer) to service_role;
grant execute on function public.monitor_error_groups(timestamptz) to service_role;
grant execute on function public.monitor_error_daily(timestamptz) to service_role;

-- --------------------------------------------------------------------------
-- 4. 效能索引(2026-09-26 效能健檢;各自對應的查詢寫在旁邊)
-- --------------------------------------------------------------------------
-- 同案同日第幾份(logs/[id]、approvals/[id]、PDF 表報編號)、案件日誌列表、儀表板最新日誌日
create index if not exists daily_logs_case_date_idx
  on public.daily_logs (case_id, log_date desc, created_at desc);
-- 主任的日誌(日誌列表、工項報表、案件總覽的主任篩選)— 也是 supervisor_id 外鍵的索引
create index if not exists daily_logs_supervisor_date_idx
  on public.daily_logs (supervisor_id, log_date desc);
-- 「我簽過的」與審閱人加簽檢查 — 也是 approver_id 外鍵的索引
create index if not exists log_approvals_approver_created_idx
  on public.log_approvals (approver_id, created_at desc);
-- 撤銷標單匯入時把工項的 import_id 清空 — 沒索引會掃整張工項表
create index if not exists case_work_items_import_idx
  on public.case_work_items (import_id) where import_id is not null;

-- 自我檢查
do $$
begin
  if not exists (select 1 from pg_class where relname = 'request_logs' and relrowsecurity) then
    raise exception '自我檢查失敗:request_logs 沒開 RLS';
  end if;
  if not exists (select 1 from pg_class where relname = 'error_logs' and relrowsecurity) then
    raise exception '自我檢查失敗:error_logs 沒開 RLS';
  end if;
  if has_table_privilege('authenticated', 'public.request_logs', 'SELECT')
     or has_table_privilege('authenticated', 'public.error_logs', 'SELECT') then
    raise exception '自我檢查失敗:authenticated 不該能讀監控表';
  end if;
  if has_function_privilege('authenticated', 'public.monitor_request_stats(timestamptz, integer)', 'EXECUTE') then
    raise exception '自我檢查失敗:authenticated 不該能呼叫監控彙總';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
