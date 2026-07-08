-- ==========================================================================
-- Migration 2.26 — attendance_events 支援「辦公室補登」
-- ==========================================================================
-- 為什麼:
--   打卡頁與回報頁的 UI 一直寫著「請聯絡辦公室協助手動補登」,但系統其實
--   沒有補登功能(INSERT policy 限本人、lat/lng NOT NULL、source 只允許
--   web/liff)。上線前補上:手機沒電 / 忘打卡是必然發生的情境,打卡又是
--   薪資證據,不能沒有補救路徑。
--
-- 設計:
--   - source 加 'manual'(補登);補登由 office_staff / owner 透過
--     server action + service-role 寫入(RLS 不開放代打,維持「本人才能
--     即時打卡」的證據性;補登走辦公室權限 + note 必填留原因)
--   - lat / lng 改為可空:補登沒有 GPS。原 check 條件保留(null 自動通過)
--   - UI 會把 source='manual' 的事件標示「補登」,與現場 GPS 打卡區隔
--
-- 跑法: Supabase SQL Editor 整份貼上。冪等。
-- ==========================================================================

alter table public.attendance_events
  alter column lat drop not null,
  alter column lng drop not null;

-- source check 加 'manual'(先 drop 舊 constraint 再重建,冪等)
do $$
begin
  alter table public.attendance_events drop constraint if exists attendance_events_source_check;
  alter table public.attendance_events
    add constraint attendance_events_source_check
    check (source in ('web', 'liff', 'manual'));
end $$;
