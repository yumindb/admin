-- ==========================================================================
-- Migration 2.34 — 系統設定表(app_settings)+ 核定雙簽開關
-- ==========================================================================
-- 用途:
--   2026-08-04 業主:「第二個核定人還沒到位,暫時先把『要兩位核定完才結案』
--   關掉。」核定雙簽是 2026-07-20 業主自己拍板的內控機制,不是刪掉而是
--   **做成開關** — 第二位核定人到職那天在畫面上打開就好,不用改程式也不用重新部署。
--
--   為什麼不是「把第二個 owner 帳號停掉就好」:
--     requiredApproveSignatures() 是數 owner 帳號數(而且原本連停用的都算進去,
--     這支同批修成只算啟用中的)。靠帳號數推規則太隱晦 —— 「為什麼日誌卡住?」
--     的答案不該是「因為某個帳號存在」。設定要能被看見、被說明、被還原。
--
-- 設計:
--   - key-value 表,之後其他系統設定共用(key 用點分命名空間:approval.xxx)
--   - value 是 jsonb — 不用為了 bool / number / 字串各開一欄
--   - 有 id uuid 是為了掛既有的 audit_trigger_fn()(它用 NEW.id 當 record_id),
--     誰在什麼時候把雙簽關掉 / 打開,audit_logs 查得到
--   - 讀:所有登入者(UI 文案要依設定變:「要兩位簽」vs「一位簽就完成」)
--   - 寫:只有 service-role(server action 內先 requireRole(['office_staff','owner']))
--     → 不開 INSERT / UPDATE policy,前端拿 anon key 改不動
--   ⚠ service-role 寫入時 auth.uid() 是 null,所以 audit_logs.changed_by 會是空 —
--     真正的操作者記在 app_settings.updated_by(會進 audit 的 after_values)。
--
-- 預設值:
--   本次種入 approval.dual_sign_enabled = **false**(業主要求的現況:單簽即完成)。
--   `on conflict do nothing` → 重跑不會把使用者後來打開的設定又關掉。
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
--
-- ✅ 執行狀態:**production(ref giclppjyuguylbqvjozx)已於 2026-08-04 執行完畢**
--    (經 Supabase MCP apply_migration,Evelyn 授權)。
-- ==========================================================================

create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null,
  -- 一句話說明這個設定在幹嘛(直接進 DB 看的人不用回頭翻程式)
  description text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- 讀:所有登入者(頁面文案要依設定調整)
drop policy if exists app_settings_select_all on public.app_settings;
create policy app_settings_select_all on public.app_settings
  for select
  to authenticated
  using (true);

-- 刻意不開 INSERT / UPDATE / DELETE policy — 寫入只走 service-role
-- (server action 內已用 requireRole 擋角色)

-- 誰改了設定要查得到:掛既有的通用 audit trigger
drop trigger if exists trg_app_settings_audit on public.app_settings;
create trigger trg_app_settings_audit
  after update or delete on public.app_settings
  for each row execute function public.audit_trigger_fn();

-- 核定雙簽開關(2026-08-04 先關,第二位核定人到職再從「人員管理」頁打開)
insert into public.app_settings (key, value, description)
values (
  'approval.dual_sign_enabled',
  'false'::jsonb,
  '核定關是否需要兩位不同的核定人都簽名才完成。false = 一位簽完即核定完成（2026-08-04 業主要求：第二位核定人尚未到位）。'
)
on conflict (key) do nothing;

-- 通知 PostgREST 重整 schema cache
notify pgrst, 'reload schema';

-- 驗證
select key, value, description, updated_at from public.app_settings order by key;
select policyname, cmd from pg_policies
  where schemaname = 'public' and tablename = 'app_settings';
