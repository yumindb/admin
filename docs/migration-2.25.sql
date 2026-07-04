-- ==========================================================================
-- Migration 2.25 — login_attempts 加裝置資訊（登入紀錄管理頁）
-- ==========================================================================
-- 為什麼:
--   業主要求「管理者要知道有誰登入」。login_attempts（migration-2.17）本來就
--   每次登入寫一筆（成功+失敗），只差:
--     1. 沒有裝置 / IP 資訊
--     2. 沒有管理介面（本次一併做 /reports/logins，僅 office_staff / owner）
--
-- 設計:
--   - user_agent / ip 純文字，由 loginAction 從 request headers 取（x-forwarded-for
--     第一段）。可能為 null（proxy 沒帶時）。
--   - RLS 維持全擋（僅 service-role），管理頁走 server component + service client
--     （與 /staff 同模式），不開 authenticated policy。
--   - retention 同步改為: 失敗紀錄 30 天、成功紀錄 365 天（lib/retention.ts）。
--     成功紀錄就是「登入紀錄」本體，30 天全刪會讓這頁失去意義。
--
-- 跑法: Supabase SQL Editor 整份貼上。冪等。
-- ==========================================================================

alter table public.login_attempts
  add column if not exists user_agent text,
  add column if not exists ip text;
