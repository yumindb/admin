-- ==========================================================================
-- Migration 2.43 — 請假代理人(工地主任請假時,指定現場人員代送施工日誌)
--                  + 請假單守門(補 2.38 / SECURITY.md 留下的「申請人自己核准」洞)
-- ==========================================================================
-- 為什麼:
--   Phil 反映:工地主任請假那幾天沒人能送施工日誌(日誌只有主任 / 老闆能填)。
--   → 主任請假時可以指定一位「現場人員」當代理人,請假期間由代理人填表、簽名、送出。
--
-- 規則(程式端 lib/leave-proxy.ts 同一套):
--   - 只有工地主任的假單可以指定代理人,代理人必須是啟用中的現場人員(field_assistant)。
--     其他主任本來就能替任何案件寫日誌(2026-05 拍板),不需要指定。
--   - 代理從**送出假單就生效**(簽核中或已核准都算)— 等全部簽完才能送,日誌就又卡住了;
--     假單被退回 / 取消 → 代理跟著失效。
--   - 代理人只能填「請假期間那幾天」(台北日期)的日誌;**新建**代理日誌只能在
--     請假第一天 ~ 最後一天 + 3 天之間(補最後一天);已經建的(退件)之後照樣能改好重送。
--   - 代理日誌的 supervisor_id = 代理人本人(他填、他簽、退回也是他改),
--     proxy_for = 請假的主任(畫面與 PDF 顯示「王小明（代理 陳主任）」)。
--   - 代理人送出後不能自己改(要改請辦公室退回),跟程式一致。
--
-- 內容:
--   1. leave_requests.proxy_id(代理人)+ 不能指定自己
--   2. daily_logs.proxy_for(這份是代理誰填的)
--   3. is_log_proxy(主任, 日期[, 要不要在代理期間內]):我是不是這位主任在這天的代理人
--      has_proxy_duty():我此刻有沒有代理任務(請假第一天 ~ 最後一天 + 3 天)
--      兩支都 SECURITY DEFINER — 代理人讀不到別人的假單(RLS),也不該讀到假別與事由
--   4. RLS(全部是新增的 policy,原本主任 / 助理 / 老闆的 policy 一條都沒動):
--      - daily_logs      logs_proxy_insert / logs_proxy_update / logs_proxy_delete
--      - log_approvals   approvals_fill_proxy_insert(只能掛在自己剛送出、在審核關的代理日誌)
--      - case_work_items work_items_proxy_insert_unsigned(代理期間新增「未簽約」臨時項)
--      代理人把現場回報併進代理日誌 **不開 RLS**,由 saveLogAction 驗完代理身分後用 service role 做
--      (UPDATE 的 policy 是 USING / WITH CHECK 各自 OR 起來的,開一條「現場人員可改 pending 回報」
--       會跟 reports_author_write 組合成「把別人的回報改成自己的再刪掉」— 2026-09-27 審查抓到)
--   5. 日誌狀態守門 trigger(2.38)把現場人員納入主任同一套規則,再加:
--      新增時關卡要對得上狀態(草稿沒有關卡、送出一定是審核關 — 主任也適用)、
--      代理人只能改草稿 / 退件、主任不能把日誌標成代理
--   6. 請假單守門 trigger(新):代理權限是從假單來的,假單就不能再讓申請人自己改狀態
--      (SECURITY.md 第二批「申請人可以把自己的假單改成 approved;簽核鏈可自己亂填」):
--      - 新增:角色、簽核鏈、第一關由資料庫依申請人**實際角色**核對;只能是簽核中;最多 30 天
--      - 修改:送出後內容(申請人、假別、起訖、時數、事由、簽核鏈)不能改;
--        狀態只能照流程走 — 申請人取消 / 目前那一關的人(不是申請人)通過到下一關、最後一關核准、退回;
--        代理人只有申請人或辦公室 / 老闆能改,而且假單要還有效
--      service role / 後台 SQL 不受限(跟日誌守門一樣)
--
-- 跑法:Supabase SQL Editor 整份貼上執行(包在一個 transaction,最後有自我檢查,
--       不符預期會 raise exception 整份 rollback)。冪等,可重跑。
-- 還原:migration-2.43-rollback.sql(拿掉新 policy / function / trigger、日誌守門還原成 2.38 版、
--       代理人設定先備份再清空;欄位保留)。
--
-- ✅ 執行狀態:**production(ref sgeuznnfasrgxlsqzxpc)已於 2026-09-27 執行完畢**
--    (Supabase MCP apply_migration,Evelyn 授權;先乾跑 + 46 項角色模擬全過再套)。
-- ==========================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. 假單的代理人
-- --------------------------------------------------------------------------
alter table public.leave_requests
  add column if not exists proxy_id uuid references public.profiles(id) on delete set null;

comment on column public.leave_requests.proxy_id is
  '代理人(migration-2.43):工地主任請假期間代送施工日誌的現場人員;null = 沒指定';

do $$ begin
  alter table public.leave_requests
    add constraint leave_requests_proxy_not_self
    check (proxy_id is null or proxy_id <> applicant_id);
exception when duplicate_object then null; end $$;

create index if not exists leave_requests_proxy_idx
  on public.leave_requests(proxy_id, end_at desc)
  where proxy_id is not null;

-- --------------------------------------------------------------------------
-- 2. 日誌:代理誰填的
-- --------------------------------------------------------------------------
alter table public.daily_logs
  add column if not exists proxy_for uuid references public.profiles(id) on delete set null;

comment on column public.daily_logs.proxy_for is
  '代理填寫(migration-2.43):這份日誌是 supervisor_id(代理人)替哪位請假的主任填的;null = 本人填';

create index if not exists daily_logs_proxy_for_idx
  on public.daily_logs(proxy_for)
  where proxy_for is not null;

-- --------------------------------------------------------------------------
-- 3. 代理判斷(SECURITY DEFINER:代理人讀不到別人的假單,但 policy 要查得到)
--    台北日期:請假 9/28 09:00 ~ 9/30 18:00 → 9/28、9/29、9/30。
--    結束時間剛好是 00:00 的那天不算(減 1 秒再取日期)。
--    申請人「現在」必須還是工地主任 — 不能只靠 applicant_role 快照。
--    p_on_duty = true:另外要求今天在「請假第一天 ~ 最後一天 + 3 天」內(新建代理日誌用);
--    天數跟 lib/leave-proxy.ts 的 PROXY_GRACE_DAYS 一致
-- --------------------------------------------------------------------------
-- 第一版草稿的 policy 與兩個參數版本的 function(沒上過正式站;保險起見一起清):
-- 兩參數版本還在的話,兩參數的呼叫會「is not unique」;policy 要先拿掉 function 才拿得掉
drop policy if exists logs_proxy_write on public.daily_logs;
drop policy if exists reports_proxy_merge on public.field_reports;
drop function if exists public.is_log_proxy(uuid, date);

create or replace function public.is_log_proxy(
  p_supervisor uuid,
  p_date date,
  p_on_duty boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.leave_requests lr
      join public.profiles sup on sup.id = lr.applicant_id
     where lr.proxy_id = auth.uid()
       and lr.applicant_id = p_supervisor
       and lr.status in ('pending', 'approved')
       and sup.role = 'site_supervisor'
       and p_date >= (lr.start_at at time zone 'Asia/Taipei')::date
       and p_date <= ((lr.end_at - interval '1 second') at time zone 'Asia/Taipei')::date
       and (
         not p_on_duty
         or (now() at time zone 'Asia/Taipei')::date
              between (lr.start_at at time zone 'Asia/Taipei')::date
                  and ((lr.end_at - interval '1 second') at time zone 'Asia/Taipei')::date + 3
       )
  );
$$;

comment on function public.is_log_proxy(uuid, date, boolean) is
  '目前登入者是不是 p_supervisor 在 p_date(台北日期)那天的請假代理人(假單簽核中或已核准);p_on_duty 另外要求今天在代理期間(含 3 天寬限)';

create or replace function public.has_proxy_duty()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.leave_requests lr
      join public.profiles sup on sup.id = lr.applicant_id
     where lr.proxy_id = auth.uid()
       and lr.status in ('pending', 'approved')
       and sup.role = 'site_supervisor'
       and (now() at time zone 'Asia/Taipei')::date
           between (lr.start_at at time zone 'Asia/Taipei')::date
               and ((lr.end_at - interval '1 second') at time zone 'Asia/Taipei')::date + 3
  );
$$;

comment on function public.has_proxy_duty() is
  '目前登入者此刻有沒有請假代理任務(請假第一天 ~ 最後一天 + 3 天)';

revoke execute on function public.is_log_proxy(uuid, date, boolean) from public, anon;
revoke execute on function public.has_proxy_duty() from public, anon;
grant execute on function public.is_log_proxy(uuid, date, boolean) to authenticated, service_role;
grant execute on function public.has_proxy_duty() to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 4a. daily_logs:代理人只能動「自己填的代理日誌」
--     新增:日期在請假期間內 + 今天在代理期間(含寬限)
--     修改:日期在請假期間內(退件過幾天才改好重送也可以);只能改草稿 / 退件由 trigger 管
--     刪除:自己的代理日誌;只能刪草稿由 trigger 管(代理結束後留下的草稿自己刪得掉)
--     請假被退回 / 取消後,新增與修改的條件都過不了 — 代理跟著失效。
--     (其他 policy 的 WITH CHECK 都要求主任 / 助理 / 老闆角色,現場人員只可能過這幾條)
-- --------------------------------------------------------------------------

drop policy if exists logs_proxy_insert on public.daily_logs;
create policy logs_proxy_insert on public.daily_logs
  for insert to authenticated
  with check (
    public.current_user_role() = 'field_assistant'
    and supervisor_id = auth.uid()
    and proxy_for is not null
    and public.is_log_proxy(proxy_for, log_date, true)
  );

drop policy if exists logs_proxy_update on public.daily_logs;
create policy logs_proxy_update on public.daily_logs
  for update to authenticated
  using (
    public.current_user_role() = 'field_assistant'
    and supervisor_id = auth.uid()
    and proxy_for is not null
  )
  with check (
    public.current_user_role() = 'field_assistant'
    and supervisor_id = auth.uid()
    and proxy_for is not null
    and public.is_log_proxy(proxy_for, log_date)
  );

drop policy if exists logs_proxy_delete on public.daily_logs;
create policy logs_proxy_delete on public.daily_logs
  for delete to authenticated
  using (
    public.current_user_role() = 'field_assistant'
    and supervisor_id = auth.uid()
    and proxy_for is not null
  );

-- --------------------------------------------------------------------------
-- 4b. log_approvals:代理人送出時寫一筆 fill(填表簽名)
--     只能掛在自己的代理日誌上,而且那份要是剛送出(submitted + 審核關)、代理還有效
--     (原本的 approvals_fill_insert 只給主任 / 老闆,不動)
-- --------------------------------------------------------------------------
drop policy if exists approvals_fill_proxy_insert on public.log_approvals;
create policy approvals_fill_proxy_insert on public.log_approvals
  for insert to authenticated
  with check (
    stage = 'fill'
    and approver_id = auth.uid()
    and public.current_user_role() = 'field_assistant'
    and exists (
      select 1
        from public.daily_logs d
       where d.id = log_approvals.log_id
         and d.supervisor_id = auth.uid()
         and d.proxy_for is not null
         and d.status = 'submitted'
         and d.current_stage = 'audit'
         and public.is_log_proxy(d.proxy_for, d.log_date)
    )
  );

-- --------------------------------------------------------------------------
-- 4c. case_work_items:代理期間可新增「未簽約」臨時項(日誌表單的「新增臨時項」與超量轉入)
--     主任的版本是 migration-2.14 的 work_items_supervisor_insert_extra(extra / unsigned 都行);
--     代理人只開 unsigned(等辦公室補報價),而且要正在代理
-- --------------------------------------------------------------------------
drop policy if exists work_items_proxy_insert_unsigned on public.case_work_items;
create policy work_items_proxy_insert_unsigned on public.case_work_items
  for insert to authenticated
  with check (
    public.current_user_role() = 'field_assistant'
    and item_type = 'unsigned'
    and created_by = auth.uid()
    and public.has_proxy_duty()
  );

-- --------------------------------------------------------------------------
-- 5. 日誌狀態守門(migration-2.38 版 + 請假代理人)
--    規則對照 app/(app)/logs/new/actions.ts:
--      a. 只有核定人(owner)能把日誌變成 approved
--      b. 主任 / 代理人新增日誌只能是 draft(沒有關卡)/ submitted(審核關)
--      c. 主任 / 代理人不能修改或刪除已核定的日誌(要改得由助理 / 核定人先「撤回核定」)
--      d. 主任 / 代理人只能刪草稿
--      e. 主任 / 代理人只能把狀態改成 draft / submitted、關卡只能設成 audit(送出)或清空(草稿)
--      f. 代理人只能改草稿 / 退件(送出後要改請辦公室退回 — 主任的「送出後編輯」代理人沒有)
--      g. 主任不能把日誌標成「代理」(proxy_for 只有代理人自己的日誌會有,RLS 另外驗代理期間)
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

  -- 分兩層 if:INSERT 時不能碰 old
  if r = 'site_supervisor' and new.proxy_for is not null then
    if tg_op = 'INSERT' then
      raise exception '只有請假代理人填的日誌可以標記代理' using errcode = '42501';
    elsif new.proxy_for is distinct from old.proxy_for then
      raise exception '只有請假代理人填的日誌可以標記代理' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'approved' and r is distinct from 'owner' then
      raise exception '只有核定人可以核定日誌' using errcode = '42501';
    end if;
    if r in ('site_supervisor', 'field_assistant') then
      if new.status not in ('draft', 'submitted') then
        raise exception '新日誌只能是草稿或送出' using errcode = '42501';
      end if;
      if (new.status = 'draft' and new.current_stage is not null)
         or (new.status = 'submitted' and new.current_stage is distinct from 'audit') then
        raise exception '送出的日誌只能進辦公室審核關' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.status = 'approved' and old.status is distinct from 'approved' and r is distinct from 'owner' then
    raise exception '只有核定人可以核定日誌' using errcode = '42501';
  end if;

  if r in ('site_supervisor', 'field_assistant') then
    if old.status = 'approved' then
      raise exception '已核定的日誌不能修改,請聯絡辦公室撤回核定' using errcode = '42501';
    end if;
    if r = 'field_assistant' and old.status not in ('draft', 'rejected') then
      raise exception '已送出的代理日誌不能自己修改,要改請辦公室退回' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and new.status not in ('draft', 'submitted') then
      raise exception '只能暫存或送出日誌' using errcode = '42501';
    end if;
    if new.current_stage is distinct from old.current_stage
       and new.current_stage is not null
       and new.current_stage <> 'audit' then
      raise exception '送出的日誌只能進辦公室審核關' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- trigger 本身(trg_daily_logs_guard)在 2.38 已建,create or replace function 後自動用新版;
-- 保險起見確認存在(不存在就建)
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_daily_logs_guard' and not tgisinternal) then
    create trigger trg_daily_logs_guard
      before insert or update or delete on public.daily_logs
      for each row execute function public.guard_daily_log_write();
  end if;
end $$;

revoke execute on function public.guard_daily_log_write() from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 6. 請假單守門(新)— 代理權限從假單來,假單的狀態就不能只靠 server action 守
--    規則對照 app/(app)/leaves/actions.ts(submit / approve / reject / cancel / updateLeaveProxy)
--    與 lib/leave.ts 的 getApprovalChain(改簽核鏈要兩邊一起改)
-- --------------------------------------------------------------------------
create or replace function public.guard_leave_request_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r public.user_role;
  uid uuid;
  expected_chain public.user_role[];
  idx int;
begin
  -- service role / 後台 SQL 不受限
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  r := public.current_user_role();
  uid := auth.uid();

  if tg_op = 'INSERT' then
    -- 申請人 = 自己(RLS 已擋);角色與簽核鏈依「實際角色」核對,不信任送來的值
    expected_chain := case r
      when 'field_assistant' then array['site_supervisor', 'office_staff', 'owner']::public.user_role[]
      when 'site_supervisor' then array['office_staff', 'owner']::public.user_role[]
      when 'office_staff' then array['owner']::public.user_role[]
      when 'reviewer' then array['owner']::public.user_role[]
      else null
    end;
    if expected_chain is null then
      raise exception '這個角色不能送請假' using errcode = '42501';
    end if;
    if new.applicant_role is distinct from r or new.approval_chain is distinct from expected_chain then
      raise exception '申請人角色或簽核鏈不符' using errcode = '42501';
    end if;
    if new.status <> 'pending'
       or new.current_step is distinct from expected_chain[1]
       or new.resolved_at is not null
       or new.cancelled_at is not null then
      raise exception '新假單只能是簽核中,從第一關開始' using errcode = '42501';
    end if;
    if new.end_at - new.start_at > interval '30 days' then
      raise exception '單次請假最多 30 天' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE:送出後內容不能改
  if new.applicant_id is distinct from old.applicant_id
     or new.applicant_role is distinct from old.applicant_role
     or new.leave_type is distinct from old.leave_type
     or new.start_at is distinct from old.start_at
     or new.end_at is distinct from old.end_at
     or new.total_hours is distinct from old.total_hours
     or new.reason is distinct from old.reason
     or new.attachment_path is distinct from old.attachment_path
     or new.approval_chain is distinct from old.approval_chain
     or new.submitted_at is distinct from old.submitted_at then
    raise exception '假單送出後內容不能修改' using errcode = '42501';
  end if;

  -- 狀態 / 關卡只能照流程走
  if new.status is distinct from old.status
     or new.current_step is distinct from old.current_step
     or new.resolved_at is distinct from old.resolved_at
     or new.cancelled_at is distinct from old.cancelled_at then
    if old.status <> 'pending' then
      raise exception '已結束的假單不能再變更' using errcode = '42501';
    end if;
    if new.status = 'cancelled' then
      if uid is distinct from old.applicant_id or new.current_step is not null then
        raise exception '只有申請人可以取消自己的假單' using errcode = '42501';
      end if;
    else
      -- 簽核:目前那一關的角色、不是申請人
      if r is distinct from old.current_step or uid = old.applicant_id then
        raise exception '目前不是你的簽核關卡' using errcode = '42501';
      end if;
      idx := array_position(old.approval_chain, old.current_step);
      if new.status = 'pending' then
        if idx is null
           or idx >= cardinality(old.approval_chain)
           or new.current_step is distinct from old.approval_chain[idx + 1] then
          raise exception '只能往下一關送' using errcode = '42501';
        end if;
      elsif new.status = 'approved' then
        if idx is distinct from cardinality(old.approval_chain) or new.current_step is not null then
          raise exception '還沒到最後一關,不能直接核准' using errcode = '42501';
        end if;
      elsif new.status = 'rejected' then
        if new.current_step is not null then
          raise exception '退回的假單不能停在關卡上' using errcode = '42501';
        end if;
      else
        raise exception '假單狀態不正確' using errcode = '42501';
      end if;
    end if;
  end if;

  -- 代理人:申請人本人或辦公室 / 老闆,假單要還有效
  if new.proxy_id is distinct from old.proxy_id then
    if new.status not in ('pending', 'approved') then
      raise exception '已結束的假單不能改代理人' using errcode = '42501';
    end if;
    if uid is distinct from new.applicant_id and r is distinct from 'office_staff' and r is distinct from 'owner' then
      raise exception '只有申請人或辦公室可以改代理人' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_leave_requests_guard on public.leave_requests;
create trigger trg_leave_requests_guard
  before insert or update on public.leave_requests
  for each row execute function public.guard_leave_request_write();

revoke execute on function public.guard_leave_request_write() from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 自我檢查:任何一項不符合就整份 rollback
-- --------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'leave_requests' and column_name = 'proxy_id'
  ) then
    raise exception '自我檢查失敗:leave_requests.proxy_id 沒建立';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'daily_logs' and column_name = 'proxy_for'
  ) then
    raise exception '自我檢查失敗:daily_logs.proxy_for 沒建立';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and (tablename, policyname) in (
           ('daily_logs', 'logs_proxy_insert'),
           ('daily_logs', 'logs_proxy_update'),
           ('daily_logs', 'logs_proxy_delete'),
           ('log_approvals', 'approvals_fill_proxy_insert'),
           ('case_work_items', 'work_items_proxy_insert_unsigned')
         )) <> 5 then
    raise exception '自我檢查失敗:代理人 policy 不是 5 條';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
              and policyname in ('logs_proxy_write', 'reports_proxy_merge')) then
    raise exception '自我檢查失敗:不該存在的代理人 policy 還在';
  end if;
  -- 原本的 policy 一條都不能少
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and (tablename, policyname) in (
           ('daily_logs', 'logs_read_all'),
           ('daily_logs', 'logs_supervisor_write'),
           ('daily_logs', 'logs_office_write'),
           ('log_approvals', 'approvals_fill_insert'),
           ('field_reports', 'reports_author_write'),
           ('field_reports', 'reports_office_merge'),
           ('case_work_items', 'work_items_supervisor_insert_extra'),
           ('leave_requests', 'leave_requests_insert_self'),
           ('leave_requests', 'leave_requests_update')
         )) <> 9 then
    raise exception '自我檢查失敗:原有的 policy 被動到了';
  end if;
  if has_function_privilege('anon', 'public.is_log_proxy(uuid, date, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.has_proxy_duty()', 'EXECUTE') then
    raise exception '自我檢查失敗:anon 可以執行代理判斷 function';
  end if;
  if not has_function_privilege('authenticated', 'public.is_log_proxy(uuid, date, boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.has_proxy_duty()', 'EXECUTE') then
    raise exception '自我檢查失敗:authenticated 不能執行代理判斷 function(policy 會全擋)';
  end if;
  if position('field_assistant' in pg_get_functiondef('public.guard_daily_log_write()'::regprocedure)) = 0 then
    raise exception '自我檢查失敗:guard_daily_log_write 沒有納入代理人';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_daily_logs_guard' and not tgisinternal) then
    raise exception '自我檢查失敗:trg_daily_logs_guard 不在';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_leave_requests_guard' and not tgisinternal) then
    raise exception '自我檢查失敗:trg_leave_requests_guard 沒建立';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- 跑完可用這幾行確認(唯讀):
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public' and policyname like '%proxy%' order by 1, 2;
--   select column_name from information_schema.columns
--    where table_schema = 'public' and column_name in ('proxy_id', 'proxy_for');
--   select tgname from pg_trigger where tgname in ('trg_daily_logs_guard', 'trg_leave_requests_guard');
