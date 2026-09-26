-- ==========================================================================
-- Migration 2.38 — 資安緊急修補(2026-09-26 健檢)
-- ==========================================================================
-- 為什麼:
--   2026-09-26 全站資安健檢,對照正式站實際的 policy / grant / trigger 找到:
--
--   1.【嚴重】任何登入的人都能把自己的 profiles.role 改成 owner。
--      profiles_self_update 只檢查「改的是自己那列」,沒限制欄位;
--      authenticated 對 profiles 全欄位有 UPDATE 權限,也沒有 trigger 擋。
--      瀏覽器裡本來就有 anon key + 使用者自己的 JWT,不經過我們的 server
--      直接打 Supabase REST API 就能升權 → 核定日誌、改單價、進人員管理重設別人密碼。
--      (migration-2.10 的註解寫「role 欄位的限制在 server action」— 但 REST API 繞得過)
--
--   2.【高】handle_new_user trigger 直接拿「註冊者自己帶的 user_metadata.role」當角色。
--      Supabase Auth 的公開註冊目前是開著的(disable_signup = false),
--      現在靠「email 要驗證」擋著;哪天驗證被關掉就等於任何人都能註冊成 owner。
--      (公開註冊請另外到 Dashboard 關掉,見 docs/SECURITY.md)
--
--   3.【高】daily-log-pdfs bucket 的三條 POC policy(poc_daily_log_pdfs_read/write/update)
--      從 migration-2.4 留到現在:任何登入者都能覆蓋已核定日誌的 PDF(偽造正式文件),
--      也能下載所有 PDF(內含所有人的簽名)。程式讀寫 PDF 全部走 service role,
--      這三條拿掉不影響任何功能。
--
--   4.【高】日誌狀態可以不經簽核直接改成「已核定」。
--      logs_supervisor_write / logs_office_write 是 FOR ALL,沒限制 status 怎麼變:
--      主任能把自己的日誌直接改成 approved、改或刪已核定的日誌;助理也能跳過核定人。
--      → 加一個 BEFORE trigger 守住狀態轉換(規則與程式現行流程一致,見下方)。
--
--   5.【衛生】SECURITY DEFINER / trigger function 對 anon 開放 EXECUTE(Supabase advisor 警告)、
--      touch_updated_at 沒鎖 search_path、current_user_role() 不看 is_active、
--      bucket 沒設檔案大小 / 類型上限。
--
-- 不在這支處理(第二批,見 migration-2.40 與 docs/SECURITY.md):
--   請假自己核准、打卡時間偽造、簽核紀錄亂插、read-all policy 收緊。
--
-- ⚠ 影響評估(已逐一對照程式碼):
--   - 角色 / 停用的修改本來就走 service role(app/(app)/staff/actions.ts)→ 不受 #1 影響
--   - 新增人員(createStaffAction)建帳號後會用 service role 覆寫 role 與 is_active → 不受 #2 影響
--     但「從 Supabase Dashboard 手動加的帳號」之後會是停用的現場人員,要到 /staff 開通
--   - #4 的規則只擋程式本來就不會做的事(主任改已核定、非核定人核定)
--
-- 跑法:Supabase SQL Editor 整份貼上執行(整份包在一個 transaction,最後有自我檢查,
--       不符合預期會 raise exception 整份 rollback)。冪等,可重跑。
-- ==========================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. profiles:一般使用者只能改自己的姓名、電話;角色 / 停用 / 公司只能走 service role
-- --------------------------------------------------------------------------
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- --------------------------------------------------------------------------
-- 2. 新帳號 trigger:不再相信註冊者自帶的 metadata
--    一律建成「停用的現場人員」— 正常流程(/staff 新增人員)會用 service role
--    立刻覆寫成正確的角色並啟用;繞過 /staff 冒出來的帳號則什麼都做不了。
-- --------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'field_assistant'::public.user_role,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- 3. current_user_role():被停用的帳號視同沒有角色(所有依角色的 policy 一律不過)
--    停用時 Auth 會 ban,但已發出的 JWT 還能用到過期(最長 1 小時)— 這層補上那段空窗
-- --------------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

-- --------------------------------------------------------------------------
-- 4. daily-log-pdfs:拿掉 POC 時期的全開 policy(PDF 只由 server 用 service role 產生與簽發)
-- --------------------------------------------------------------------------
drop policy if exists poc_daily_log_pdfs_read on storage.objects;
drop policy if exists poc_daily_log_pdfs_write on storage.objects;
drop policy if exists poc_daily_log_pdfs_update on storage.objects;

-- --------------------------------------------------------------------------
-- 5. 日誌狀態轉換守門(只管一般登入者;service role / 後台 SQL 不受限)
--    規則(對照 app/(app)/logs/new/actions.ts、app/(app)/approvals/[id]/actions.ts):
--      a. 只有核定人(owner)能把日誌變成 approved
--      b. 主任新增日誌只能是 draft / submitted
--      c. 主任不能修改或刪除已核定的日誌(要改得由助理 / 核定人先「撤回核定」)
--      d. 主任只能刪草稿
--      e. 主任只能把狀態改成 draft / submitted、關卡只能設成 audit(送出)或清空(草稿)
-- --------------------------------------------------------------------------
create or replace function public.guard_daily_log_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r public.user_role;
begin
  -- PostgREST 用 service key 時 current_user = service_role;SQL editor 是 postgres
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  r := public.current_user_role();

  if tg_op = 'DELETE' then
    if r is distinct from 'owner' and r is distinct from 'office_staff' and old.status <> 'draft' then
      raise exception '只能刪除草稿' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'approved' and r is distinct from 'owner' then
      raise exception '只有核定人可以核定日誌' using errcode = '42501';
    end if;
    if r = 'site_supervisor' and new.status not in ('draft', 'submitted') then
      raise exception '新日誌只能是草稿或送出' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.status = 'approved' and old.status is distinct from 'approved' and r is distinct from 'owner' then
    raise exception '只有核定人可以核定日誌' using errcode = '42501';
  end if;

  if r = 'site_supervisor' then
    if old.status = 'approved' then
      raise exception '已核定的日誌不能修改,請聯絡辦公室撤回核定' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and new.status not in ('draft', 'submitted') then
      raise exception '主任只能暫存或送出日誌' using errcode = '42501';
    end if;
    if new.current_stage is distinct from old.current_stage
       and new.current_stage is not null
       and new.current_stage <> 'audit' then
      raise exception '主任送出的日誌只能進辦公室審核關' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_daily_logs_guard on public.daily_logs;
create trigger trg_daily_logs_guard
  before insert or update or delete on public.daily_logs
  for each row execute function public.guard_daily_log_write();

-- --------------------------------------------------------------------------
-- 6. function 權限衛生
--    trigger / event trigger function 觸發時不檢查 EXECUTE,拿掉 REST 可直呼的權限不影響運作。
--    current_user_role() 會在 policy 裡以 authenticated 身分執行,所以只拿掉 anon。
-- --------------------------------------------------------------------------
revoke execute on function public.audit_trigger_fn() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.guard_daily_log_write() from public, anon, authenticated;
revoke execute on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated, service_role;

do $$
begin
  -- rls_auto_enable 是 Supabase 建專案時帶的 event trigger function,不一定每個環境都有
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

alter function public.touch_updated_at() set search_path = '';

-- --------------------------------------------------------------------------
-- 7. bucket 上限(程式本來就擋 8MB / 只收圖片,這裡是 REST 直連時的第二道防線)
--    目前實際:照片最大 2.9MB(全 jpeg)、簽名最大 0.8MB(全 png)
-- --------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 15 * 1024 * 1024,
       allowed_mime_types = array['image/*']
 where id = 'daily-photos';

update storage.buckets
   set file_size_limit = 5 * 1024 * 1024,
       allowed_mime_types = array['image/png', 'image/jpeg']
 where id = 'signatures';

-- --------------------------------------------------------------------------
-- 自我檢查:任何一項不符合就整份 rollback
-- --------------------------------------------------------------------------
do $$
begin
  if has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') then
    raise exception '自我檢查失敗:authenticated 仍可 UPDATE profiles.role';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'is_active', 'UPDATE') then
    raise exception '自我檢查失敗:authenticated 仍可 UPDATE profiles.is_active';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') then
    raise exception '自我檢查失敗:authenticated 應可 UPDATE profiles.full_name';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname like 'poc_daily_log_pdfs_%') then
    raise exception '自我檢查失敗:poc_daily_log_pdfs_* policy 還在';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_daily_logs_guard' and not tgisinternal) then
    raise exception '自我檢查失敗:trg_daily_logs_guard 沒建立';
  end if;
  if has_function_privilege('anon', 'public.current_user_role()', 'EXECUTE') then
    raise exception '自我檢查失敗:anon 仍可執行 current_user_role()';
  end if;
  if not has_function_privilege('authenticated', 'public.current_user_role()', 'EXECUTE') then
    raise exception '自我檢查失敗:authenticated 不能執行 current_user_role()(所有 policy 會壞)';
  end if;
  if position('raw_user_meta_data->>''role''' in pg_get_functiondef('public.handle_new_user()'::regprocedure)) > 0 then
    raise exception '自我檢查失敗:handle_new_user 仍讀 metadata 的 role';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- 跑完可用這幾行確認(唯讀):
--   select grantee, privilege_type, column_name from information_schema.column_privileges
--    where table_schema='public' and table_name='profiles' and grantee='authenticated' order by 3;
--   select policyname from pg_policies where schemaname='storage' order by 1;
--   select id, file_size_limit, allowed_mime_types from storage.buckets order by id;
