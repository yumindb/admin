-- ==========================================================================
-- Migration 2.35 — 新角色「審閱人」(reviewer):只加 enum 值
-- ==========================================================================
-- 用途:
--   2026-09-09 業主拍板:核定維持一位核定人簽完就產 PDF(雙簽整套拿掉);
--   另外加一個角色「審閱人」— 日誌在辦公室審核通過後、核定前多一關在系統上簽核,
--   簽名與意見**不進 PDF**。
--
--   審閱關沿用 approval_stage 既有的 'review' 值(原本給「主任複核」,production
--   從沒用過:log_approvals 零筆 stage='review'),所以 stage enum 不用改。
--
-- ⚠ 為什麼拆成兩支:
--   `alter type ... add value` 新增的值**不能在同一個 transaction 裡使用**
--   (Postgres 會報 "unsafe use of new value")。migration-2.36 的 RLS policy 要寫
--   'reviewer' 字面值,所以先跑這支、確定 commit 之後,再跑 2.36。
--   Supabase SQL Editor 一次貼一支就沒問題。
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等(if not exists)。
-- ==========================================================================

alter type public.user_role add value if not exists 'reviewer';

-- 驗證:應列出 5 個值,含 reviewer
select enumlabel from pg_enum
  where enumtypid = 'public.user_role'::regtype
  order by enumsortorder;
