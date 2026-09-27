-- ==========================================================================
-- Migration 2.43 還原 — 拿掉請假代理人與請假單守門
-- ==========================================================================
-- 什麼時候用:2.43 套上去之後,主任 / 助理 / 老闆的正常日誌或請假流程出問題,要先退回原狀。
--
-- 做的事:
--   - 拿掉 2.43 新增的 5 條 policy、2 支代理判斷 function、請假單守門 trigger
--     (請假單守門只想留著的話,把第 3 段刪掉再跑)
--   - 日誌守門 trigger 還原成 2.38 版(內容是 2026-09-27 從正式站讀出的定義)
--   - 已設定的代理人**先備份到 _backup_migration_2_43_proxy_ids 再清空** — 不清的話
--     主任 / 現場人員畫面還會出現代理入口,但資料庫已經不讓代理人存日誌
--   - **欄位保留**(leave_requests.proxy_id、daily_logs.proxy_for):留著不影響任何舊功能;
--     已經寫好的代理日誌照樣顯示「代理 X」
--
-- 跑法:Supabase SQL Editor 整份貼上執行。冪等。
-- ==========================================================================

begin;

-- 1. policy 與代理判斷
drop policy if exists logs_proxy_insert on public.daily_logs;
drop policy if exists logs_proxy_update on public.daily_logs;
drop policy if exists logs_proxy_delete on public.daily_logs;
drop policy if exists logs_proxy_write on public.daily_logs;
drop policy if exists approvals_fill_proxy_insert on public.log_approvals;
drop policy if exists work_items_proxy_insert_unsigned on public.case_work_items;

drop function if exists public.is_log_proxy(uuid, date, boolean);
drop function if exists public.is_log_proxy(uuid, date);
drop function if exists public.has_proxy_duty();

-- 2. 代理人設定:備份後清空(程式看不到代理任務,入口自然消失)
create table if not exists public._backup_migration_2_43_proxy_ids (
  leave_id    uuid primary key,
  proxy_id    uuid,
  backed_up_at timestamptz not null default now()
);
alter table public._backup_migration_2_43_proxy_ids enable row level security;  -- 沒有 policy = 只有 service role 讀得到

insert into public._backup_migration_2_43_proxy_ids (leave_id, proxy_id)
select id, proxy_id from public.leave_requests where proxy_id is not null
on conflict (leave_id) do update set proxy_id = excluded.proxy_id, backed_up_at = now();

-- 3. 請假單守門(先拿掉,下面的清空才不會被擋 — 其實 SQL editor 本來就不受限,保險起見)
drop trigger if exists trg_leave_requests_guard on public.leave_requests;
drop function if exists public.guard_leave_request_write();

update public.leave_requests set proxy_id = null where proxy_id is not null;

-- 4. 日誌守門還原成 2.38 版
create or replace function public.guard_daily_log_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r public.user_role;
begin
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

revoke execute on function public.guard_daily_log_write() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and policyname in (
      'logs_proxy_insert', 'logs_proxy_update', 'logs_proxy_delete', 'logs_proxy_write',
      'approvals_fill_proxy_insert', 'work_items_proxy_insert_unsigned')) then
    raise exception '還原失敗:代理人 policy 還在';
  end if;
  if position('field_assistant' in pg_get_functiondef('public.guard_daily_log_write()'::regprocedure)) > 0 then
    raise exception '還原失敗:guard_daily_log_write 還是 2.43 版';
  end if;
  if exists (select 1 from public.leave_requests where proxy_id is not null) then
    raise exception '還原失敗:代理人設定沒清乾淨';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
