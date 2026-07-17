-- ==========================================================================
-- Migration 2.27 — LINE 通知（line_bindings + notification_queue）
-- ==========================================================================
-- 用途:
--   LINE 官方帳號（@449ibxsb）推播通知的資料基礎。
--
--   line_bindings — 使用者 ↔ LINE 帳號綁定:
--     - 使用者在 /account 產生 6 位數綁定碼（30 分鐘有效）
--     - 加官方帳號好友後把綁定碼傳給官方帳號
--     - webhook（/api/line/webhook, service-role）比對 binding_code 寫入 line_user_id
--     - 封鎖官方帳號（unfollow）→ webhook 自動清除 line_user_id（解綁）
--     - notifications_enabled 讓使用者自行暫停通知（不用解綁）
--
--   notification_queue — 推播佇列 + 審計:
--     - server actions 在狀態變更成功後 enqueue（after()，不阻塞主流程）
--     - 立刻嘗試推播;失敗的由夜間 cron（recheck-stuck-pdfs 共用 endpoint）重試
--     - 同 profile_id + event_type + related_id 十分鐘內去重（程式端檢查）
--     - 只留 30 天,由 retention 清理
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
-- ==========================================================================

-- ==========================================================================
-- 1. line_bindings
-- ==========================================================================
create table if not exists public.line_bindings (
  profile_id              uuid primary key references public.profiles(id) on delete cascade,
  line_user_id            text unique,             -- LINE Messaging API 的 userId;null = 未綁定
  binding_code            text unique,             -- 6 位數綁定碼;綁定完成後清空
  binding_code_expires_at timestamptz,
  notifications_enabled   boolean not null default true,
  bound_at                timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

do $$ begin
  create trigger trg_line_bindings_updated_at before update on public.line_bindings
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

-- ==========================================================================
-- 2. notification_queue
-- ==========================================================================
create table if not exists public.notification_queue (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  event_type  text not null,          -- e.g. 'log_submitted' / 'log_rejected' / 'leave_submitted'
  related_id  uuid,                   -- 日誌 / 請假 / 回報 id;彙總訊息（批簽）為 null
  alt_text    text not null,          -- LINE 通知列顯示的純文字
  message     jsonb not null,         -- 完整 LINE message 物件（flex）
  status      text not null default 'pending'
                check (status in ('pending', 'sent', 'failed', 'skipped')),
  error       text,
  attempts    int not null default 0,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

-- 去重查詢用（同 profile + event + related 十分鐘內）
create index if not exists notification_queue_dedupe_idx
  on public.notification_queue(profile_id, event_type, created_at desc);

-- cron 重試用（只掃還沒送成的）
create index if not exists notification_queue_retry_idx
  on public.notification_queue(created_at)
  where status in ('pending', 'failed');

-- ==========================================================================
-- RLS
-- ==========================================================================
-- 政策:
--   line_bindings:
--     - SELECT:本人 + office_staff / owner(帳號管理頁未來可看綁定狀態)
--     - INSERT / UPDATE:本人(產生綁定碼、開關通知、解綁)
--     - DELETE:不開(解綁 = 清欄位)
--     - webhook 端寫入走 service-role,不受此限
--   notification_queue:
--     - SELECT:本人(除錯用;訊息本體不含敏感細節)
--     - INSERT / UPDATE / DELETE:不開(只有 service-role 寫)

alter table public.line_bindings enable row level security;
alter table public.notification_queue enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('line_bindings', 'notification_queue')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------- line_bindings ----------

create policy line_bindings_read on public.line_bindings
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.current_user_role() in ('office_staff', 'owner')
  );

create policy line_bindings_insert_self on public.line_bindings
  for insert to authenticated
  with check (profile_id = auth.uid());

create policy line_bindings_update_self on public.line_bindings
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- 不開 DELETE

-- ---------- notification_queue ----------

create policy notification_queue_read_self on public.notification_queue
  for select to authenticated
  using (profile_id = auth.uid());

-- 不開 INSERT / UPDATE / DELETE(service-role only)
