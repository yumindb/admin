-- ==========================================================================
-- Migration 2.22 — 隱式 GPS 戳記 (daily_logs / field_reports)
-- ==========================================================================
-- 用途:
--   工地主任送日誌、現場助理送回報「當下」的位置,自動記錄。
--   不是顯式打卡(那個走 attendance_events),而是讓送出動作本身帶位置證據。
--
--   政策:
--   - 只在「首次送出」/「首次建立」時寫入。post-submission 編輯不重寫(保留原始送出位置)。
--   - 若使用者沒授權定位,所有欄位都允許 null(不阻擋送出)。
--   - within_geofence = false 仍寫入(軟警告;報表會標註)。
--
--   case 已在 migration-2.20 加 lat/lng/geofence_radius_m,server 端會算 distance + within。
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
-- ==========================================================================

alter table public.daily_logs
  add column if not exists submit_lat numeric(9,6)
    check (submit_lat is null or (submit_lat >= -90 and submit_lat <= 90)),
  add column if not exists submit_lng numeric(9,6)
    check (submit_lng is null or (submit_lng >= -180 and submit_lng <= 180)),
  add column if not exists submit_accuracy_m numeric(8,2),
  add column if not exists submit_distance_m numeric(10,2),
  add column if not exists submit_within_geofence boolean;

alter table public.field_reports
  add column if not exists submit_lat numeric(9,6)
    check (submit_lat is null or (submit_lat >= -90 and submit_lat <= 90)),
  add column if not exists submit_lng numeric(9,6)
    check (submit_lng is null or (submit_lng >= -180 and submit_lng <= 180)),
  add column if not exists submit_accuracy_m numeric(8,2),
  add column if not exists submit_distance_m numeric(10,2),
  add column if not exists submit_within_geofence boolean;
