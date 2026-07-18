-- ==========================================================================
-- Migration 2.28 — LINE 通知偏好(分類開關)
-- ==========================================================================
-- 為什麼:
--   業主要求通知改「白名單制」:老闆 / 辦公室助理在 /staff 幫每個人設定
--   要收哪些通知;工地主任 / 現場人員預設全關,被設定了才收得到。
--
-- 設計:
--   line_bindings 加 notification_prefs jsonb:
--     null                     = 從未設定 → 全走角色預設
--                                (owner / office_staff 全開;主任 / 現場人員全關)
--     {"logs_to_review": true, ...} = 有明確值的分類用明確值,缺的 key 走角色預設
--   分類 key(見 lib/notifications/prefs.ts,單一事實來源):
--     logs_to_review / log_results / leaves_to_review / leave_results / field_reports
--
--   寫入只走 /staff 的 server action(requireManager + service-role),
--   不開放使用者自己改 → RLS 不需要變更(既有 update_self policy 雖可讓本人
--   碰到這欄,但本人只能改自己的,且 UI 沒有入口;維持簡單)。
--
-- 跑法: Supabase SQL Editor 整份貼上。冪等。
-- ==========================================================================

alter table public.line_bindings
  add column if not exists notification_prefs jsonb;
