-- ==========================================================================
-- Migration 2.20 — 案件座標 (cases.lat / lng / geofence_radius_m)
-- ==========================================================================
-- 用途:
--   為「現場人員 / 工地主任 GPS 打卡」鋪路。每個案件需要一組座標 + 半徑
--   (geofence),才能計算打卡時離工地多遠、是否在合理範圍內。
--
--   座標來源:辦公室開案 / 編輯案件時,貼 Google Maps 連結自動解析、
--   或在嵌入地圖上點選。
--
--   半徑預設 200 m(透天工地夠用);大工地(自地自建整塊地)由 office 調高。
--
--   軟警告政策:打卡 *仍可送出*,但離工地超過半徑會被標註為「不在工地範圍」,
--   office / owner 在報表頁可一眼看到。
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
-- ==========================================================================

alter table public.cases
  add column if not exists lat numeric(9,6),                       -- WGS84;6 位小數約 11 公分精度
  add column if not exists lng numeric(9,6),
  add column if not exists geofence_radius_m integer not null default 200
    check (geofence_radius_m > 0 and geofence_radius_m <= 5000);

-- 同時補 (lat, lng) 必須一起填的 sanity check:不允許半填(只有經度沒緯度,反之亦然)
do $$ begin
  alter table public.cases
    add constraint cases_latlng_paired check (
      (lat is null and lng is null) or (lat is not null and lng is not null)
    );
exception when duplicate_object then null; end $$;

-- 範圍 sanity check(雖然 numeric(9,6) 已限位數,但加上極值約束更保險)
do $$ begin
  alter table public.cases
    add constraint cases_lat_range check (lat is null or (lat >= -90 and lat <= 90));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.cases
    add constraint cases_lng_range check (lng is null or (lng >= -180 and lng <= 180));
exception when duplicate_object then null; end $$;
