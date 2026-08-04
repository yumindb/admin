-- ==========================================================================
-- Migration 2.33 — 站內消息(app_messages):簽核意見要在 App 裡跳出來
-- ==========================================================================
-- 用途:
--   2026-08-04 業主回饋:「日誌我核過的,但是我有在下面給意見,可是底下的人
--   他們那裡不會跳通知出來,所以他們也不會知道。」
--
--   現況:所有通知都只走 LINE(notification_queue → LINE push),
--   而底下的人**沒有綁 LINE**(問過也沒有想綁的意思,助理習慣用電腦),
--   所以簽核意見寫了等於沒人看到 — 它只靜靜躺在日誌頁最底下的簽核歷程裡。
--
--   解法:站內消息中心。與 LINE 無關、不需綁定、不吃官方帳號額度,
--   登入就看得到(header 鈴鐺 + 未讀紅點 → /messages)。
--
--   投遞規則(業主拍板:「有意見,再有消息就好」):
--     - 簽核**通過但有寫意見** → 發消息
--     - 退回 / 強制退回 / 撤回核定(一定有原因) → 發消息
--     - 通過且沒寫意見 → 不發(不然每天一堆「已核定」洗版)
--   收件人 = 該份日誌的主任 + 這一輪前面關卡經手過的人,排除留言者自己。
--
-- 設計:
--   - 只有 server 端(service-role)能寫入 → 沒有 INSERT policy,使用者無法偽造消息
--   - 使用者只能讀自己的、只能把自己的標成已讀(UPDATE policy 綁 profile_id)
--   - 沒有 DELETE policy — 清理走 nightly cron 的 retention(lib/retention.ts)
--   - 訊息內容是「當下的快照」;意見的正本永遠在 log_approvals,
--     消息只是把人帶過去的信封
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
--
-- ✅ 執行狀態:**production(ref giclppjyuguylbqvjozx)已於 2026-08-04 執行完畢**
--    (經 Supabase MCP apply_migration,Evelyn 授權)。驗證結果:
--    表已建立、RLS enabled、2 條 policy(select_own / update_own)、4 個索引、0 筆資料。
--    新環境重建時仍需照跑。
-- ==========================================================================

create table if not exists public.app_messages (
  id uuid primary key default gen_random_uuid(),
  -- 收件人
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- 事件類型(log_comment / log_rejected / log_revoked …),之後要分類篩選用
  event_type text not null,
  title text not null,
  body text,
  -- 點開要去哪(例:/logs/<id>#approval-trail)
  link text,
  -- 關聯物件 id(日誌 id 等),去重與「這份日誌的消息」查詢用
  related_id uuid,
  -- 誰造成這則消息(留言者);帳號刪掉時消息留著,只是不知道是誰
  actor_id uuid references public.profiles(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- 收件匣:某人的消息依時間倒序
create index if not exists app_messages_inbox_idx
  on public.app_messages (profile_id, created_at desc);

-- 未讀數(header 鈴鐺每頁都要算一次)— partial index,只索引未讀那幾筆
create index if not exists app_messages_unread_idx
  on public.app_messages (profile_id)
  where read_at is null;

-- 去重查詢(同一份日誌 + 同事件 + 同收件人,短時間內只發一則)
create index if not exists app_messages_dedupe_idx
  on public.app_messages (related_id, event_type);

alter table public.app_messages enable row level security;

-- 讀:只讀自己的
drop policy if exists app_messages_select_own on public.app_messages;
create policy app_messages_select_own on public.app_messages
  for select
  to authenticated
  using (profile_id = auth.uid());

-- 寫已讀:只能動自己的 row(改不到別人的收件匣)。
-- 內容欄位理論上也改得動,但那只影響他自己看到的信封 —
-- 意見正本在 log_approvals,不受影響。
drop policy if exists app_messages_update_own on public.app_messages;
create policy app_messages_update_own on public.app_messages
  for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- 刻意不建 INSERT / DELETE policy:
--   INSERT 只由 server 端 service-role 寫(lib/notifications/messages.ts)
--   DELETE 只由 nightly cron 的 retention 清(service-role)

-- 通知 PostgREST 重整 schema cache
notify pgrst, 'reload schema';

-- 驗證:應看到 2 條 policy(select / update),4 個索引(pk + 3)
select policyname, cmd
  from pg_policies
  where schemaname = 'public' and tablename = 'app_messages'
  order by policyname;

select indexname
  from pg_indexes
  where schemaname = 'public' and tablename = 'app_messages'
  order by indexname;
