-- ==========================================================================
-- Migration 2.13 — 合約外 / 未簽約 升等為案件級工項
-- ==========================================================================
-- 把原本散在 daily_logs.extra_items / unsigned_items jsonb 的內容,
-- 升等成 case_work_items 的一等公民,讓它們:
--   - 跨日誌延續(同一個未簽約項目可在多份日誌填進度)
--   - 可累計進度 + percent mode + 完成自動隱藏
--   - 可事後補單價/複價(報價)
--   - 可由 office_staff/owner 標記為已簽約 → 自動歸到合約外
--
-- 變更:
--   1. work_item_type enum 加 'extra'(合約外、已簽約追加)+ 'unsigned'(未簽約)
--   2. case_work_items 加:
--      - quote_status text  待報價/已報價(無單價→待報價;有單價→已報價)
--      - contract_signed_at timestamptz  未簽約 → 合約外的時間戳
--      - contract_note text  簽約備註(必填,例如「2026-05-08 LINE 同意追加」)
--      - created_by uuid  哪個 profile 建的(現場填日誌時自動帶,也支援案件總覽手動加)
--   3. 舊的 daily_logs.extra_items / unsigned_items jsonb 不刪,讓舊日誌仍能 read-only 顯示
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
-- 注意:alter type ... add value 不能在 transaction;SQL Editor 一行一行送沒問題。
-- ==========================================================================

-- 1. enum 加兩個新類型
alter type public.work_item_type add value if not exists 'extra' after 'manual';
alter type public.work_item_type add value if not exists 'unsigned' after 'extra';

-- 2. case_work_items 加欄位
alter table public.case_work_items
  add column if not exists quote_status text,
  add column if not exists contract_signed_at timestamptz,
  add column if not exists contract_note text,
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- 註解
comment on column public.case_work_items.quote_status is
  '報價狀態:''pending''=待報價,''quoted''=已報價(office_staff 填單價後手動或自動切)。僅對 item_type IN (''extra'',''unsigned'') 有意義';
comment on column public.case_work_items.contract_signed_at is
  '未簽約 → 合約外的時間戳。null 表尚未簽約';
comment on column public.case_work_items.contract_note is
  '簽約備註(自由文字,例:「2026-05-08 LINE 同意追加」)';
comment on column public.case_work_items.created_by is
  '誰建立此工項。標單匯入為 null;手動新增由 server action 帶入 auth.uid()';

-- 3. 加索引讓案件頁可以快速分類取出
create index if not exists case_work_items_type_idx
  on public.case_work_items(case_id, item_type);

-- 4. 驗證
select item_type, count(*)
  from public.case_work_items
  group by item_type
  order by item_type;
