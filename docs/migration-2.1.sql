-- ==========================================================================
-- Phase 2.1 migration — daily_logs 加合約外 / 未簽約 兩個 jsonb 欄位
-- ==========================================================================
-- 對齊「裕民現有資料/表單/內部施工日誌格式.xlsx」的六大區塊:
--   1. 依施工計畫書執行 → 已有 work_items
--   2. 外包人員及機具    → 暫用 manpower(POC 簡化)
--   3. 通知協力廠商      → 暫用 notes
--   4. 非合約內施工項目  → 新增 extra_items jsonb
--   5. 未簽約施工內容    → 新增 unsigned_items jsonb
--   6. 重要事項紀錄      → notes
--
-- 跑法:Supabase SQL Editor 整份貼上。冪等。
-- ==========================================================================

alter table public.daily_logs
  add column if not exists extra_items jsonb not null default '[]'::jsonb,
  add column if not exists unsigned_items jsonb not null default '[]'::jsonb;

-- 註解
comment on column public.daily_logs.extra_items is
  '非合約內施工項目:[{name, unit?, qty?, headcount?, location?, requested_by?, reason?}]';
comment on column public.daily_logs.unsigned_items is
  '未簽約施工內容:[{name, unit?, qty?, headcount?, category?: 點工|變更追加, quote_amount?, reason?}]';

-- 驗證
select count(*) as logs_total,
       count(*) filter (where jsonb_array_length(extra_items) > 0) as has_extras,
       count(*) filter (where jsonb_array_length(unsigned_items) > 0) as has_unsigned
from public.daily_logs;
