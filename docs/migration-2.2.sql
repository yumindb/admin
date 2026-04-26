-- Phase 2.2 migration — 補齊日誌表中的「通知協力廠商辦理事項」
alter table public.daily_logs
  add column if not exists vendor_notices text;

