-- ==========================================================================
-- Migration 2.6 — 角色擴充：新增「現場助理 (field_assistant)」+ 帳號停用旗標
-- ==========================================================================
-- 用途：
--   1. user_role enum 加入 'field_assistant'。權限為「只能新增施工日誌」，
--      不能審核、不能管帳號、不能改案件。
--   2. profiles 加 is_active boolean — 帳號停用旗標（不刪除，保留簽核歷史完整性）。
--
-- 跑法：Supabase SQL Editor 貼上執行。冪等。
-- 注意：alter type ... add value 不能在 transaction 中。SQL Editor 預設一條
--       一條送，沒問題。
-- ==========================================================================

alter type public.user_role add value if not exists 'field_assistant';

alter table public.profiles
  add column if not exists is_active boolean not null default true;

create index if not exists profiles_is_active_idx on public.profiles(is_active);
