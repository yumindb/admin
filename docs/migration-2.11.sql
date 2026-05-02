-- ==========================================================================
-- Migration 2.11 — daily_logs.pdf_status + pdf_error
-- ==========================================================================
-- 用途:
--   核定通過後 PDF 是用 next/server 的 after() 在 background 產生,
--   原本只有 pdf_path 一個訊號(null = 還沒產;有值 = 產好了)。
--   無法區分以下三種狀態:
--     - 還在背景產(spinner)
--     - 失敗了(顯示錯誤 + 重試按鈕)
--     - 完成(顯示下載按鈕)
--
-- 新增 pdf_status enum + pdf_error,讓 UI 能正確 render:
--   - pending    : 尚未進入產 PDF 流程(approved 之前皆此狀態,或 approved 後 race condition 容錯)
--   - generating : after() 已 enqueue,正在產
--   - done       : 上傳成功 + pdf_path 寫好
--   - failed     : 任一步失敗,pdf_error 紀錄訊息
--
-- 既有 row 推斷:
--   - pdf_path is not null → 'done'
--   - pdf_path is null     → 'pending'(approved 但卡住的會在下一次 regeneratePdfAction 翻成 done/failed)
--
-- 跑法:Supabase SQL Editor 整份貼上執行。冪等。
-- ==========================================================================

-- 1. enum
do $$ begin
  create type pdf_status as enum ('pending', 'generating', 'done', 'failed');
exception when duplicate_object then null; end $$;

grant usage on type public.pdf_status to supabase_auth_admin;

-- 2. 加欄位
alter table public.daily_logs
  add column if not exists pdf_status pdf_status not null default 'pending';

alter table public.daily_logs
  add column if not exists pdf_error text;

-- 3. 既有資料補狀態(只跑一次有效;之後新 row 走 default 'pending')
update public.daily_logs
  set pdf_status = 'done'
  where pdf_path is not null
    and pdf_status = 'pending';

-- 4. index — 之後可能要查「卡 generating > N 分鐘的 row」做監控
create index if not exists daily_logs_pdf_status_idx
  on public.daily_logs(pdf_status)
  where pdf_status in ('generating', 'failed');

-- 驗證
-- select pdf_status, count(*) from public.daily_logs group by pdf_status;
