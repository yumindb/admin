-- ==========================================================================
-- Migration 2.5 — approval_stage 加 'fill' (填表人簽名)
-- ==========================================================================
-- 用途：四關每關都收手寫簽名 — 填表人(主任送出時)、複核、審核、核定。
--   填表人簽完即作為一筆 log_approvals (stage='fill', decision='approved')，
--   讓 PDF 簽核紀錄區塊可以一致地顯示四個簽名圖。
--
-- 跑法：Supabase SQL Editor 貼上執行。冪等。
-- 注意：alter type ... add value 不能在 transaction 中。SQL Editor 預設一條
--       一條送，沒問題。
-- ==========================================================================

alter type public.approval_stage add value if not exists 'fill' before 'review';
