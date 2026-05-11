-- ==========================================================================
-- Migration 2.19 — audit_logs 表 + trigger(帳號/角色/報價/合約變更)
-- ==========================================================================
-- 為什麼:
--   2026-05-11 健檢發現:日誌簽核有完整 audit trail(log_approvals + daily_log_revisions),
--   但「帳號角色」「工項報價」「追加合約金額」三類敏感變更完全沒記錄。
--   試跑期若發生爭議(「為什麼這項報價改了?」「誰把我升 owner?」),無法回查。
--
-- 範圍:
--   - profiles 全表(角色、停用、姓名、公司)
--   - case_work_items 的 unit_price / total_price / quantity(財務相關欄位)
--   - extra_contracts 全表(bundle_price / signed_at / note / name)
--
-- 設計:
--   - 統一 audit_logs 表:table_name + record_id + action + changed_by + before/after jsonb
--   - trigger AFTER UPDATE / DELETE → 寫一筆
--   - INSERT 不記錄(created_at + created_by 在主表本身已有)
--   - changed_fields 陣列方便 SQL 過濾(例:找所有改過 unit_price 的紀錄)
--   - SELECT 限 office_staff / owner;INSERT 走 trigger(SECURITY DEFINER 繞 RLS)
--   - 無 UPDATE / DELETE policy → 任何人不可竄改 audit
--
-- 查法(在 Supabase SQL Editor):
--   -- 看誰改了某張工項的單價:
--   select changed_at, p.full_name, changed_fields, before_values->'unit_price', after_values->'unit_price'
--     from audit_logs a
--     left join profiles p on p.id = a.changed_by
--    where a.table_name = 'case_work_items'
--      and a.record_id = 'xxxx-uuid'
--      and 'unit_price' = any(a.changed_fields)
--    order by changed_at desc;
--
-- 跑法: Supabase SQL Editor 整份貼上。冪等。
-- ==========================================================================

-- 1. audit_logs 表
create table if not exists public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  table_name      text not null,
  record_id       uuid not null,
  action          text not null check (action in ('update', 'delete')),
  changed_by      uuid references public.profiles(id) on delete set null,
  changed_at      timestamptz not null default now(),
  changed_fields  text[],
  before_values   jsonb,
  after_values    jsonb
);

create index if not exists audit_logs_table_record_idx
  on public.audit_logs(table_name, record_id, changed_at desc);
create index if not exists audit_logs_changed_at_idx
  on public.audit_logs(changed_at desc);
create index if not exists audit_logs_changed_by_idx
  on public.audit_logs(changed_by, changed_at desc);

alter table public.audit_logs enable row level security;

-- 清舊 policy(冪等)
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'audit_logs'
  loop
    execute format('drop policy %I on public.audit_logs', r.policyname);
  end loop;
end $$;

-- SELECT:只有 office_staff / owner 能看(關乎隱私 + 權力分立)
create policy audit_logs_select_staff_owner on public.audit_logs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('office_staff', 'owner')
        and is_active = true
    )
  );

-- 不開 INSERT / UPDATE / DELETE policy
-- → trigger 用 SECURITY DEFINER 繞 RLS 寫入;一般使用者無法竄改

-- 2. 通用 trigger function
create or replace function public.audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_v jsonb;
  after_v jsonb;
  changed text[];
  k text;
  watched_cols text[];
begin
  if TG_OP = 'DELETE' then
    insert into public.audit_logs(table_name, record_id, action, changed_by, before_values)
    values (TG_TABLE_NAME, OLD.id, 'delete', auth.uid(), to_jsonb(OLD));
    return OLD;
  end if;

  -- TG_OP = 'UPDATE'
  before_v := to_jsonb(OLD);
  after_v := to_jsonb(NEW);
  changed := array[]::text[];

  -- 如果 trigger 帶參數,只看這些欄位;否則看全部
  if TG_NARGS > 0 then
    watched_cols := TG_ARGV::text[];
    foreach k in array watched_cols loop
      if before_v->k is distinct from after_v->k then
        changed := array_append(changed, k);
      end if;
    end loop;
  else
    for k in select jsonb_object_keys(before_v) loop
      -- 跳過 updated_at(每次 update 都會變,沒意義)
      if k = 'updated_at' then continue; end if;
      if before_v->k is distinct from after_v->k then
        changed := array_append(changed, k);
      end if;
    end loop;
  end if;

  if array_length(changed, 1) > 0 then
    insert into public.audit_logs(
      table_name, record_id, action, changed_by,
      changed_fields, before_values, after_values
    )
    values (
      TG_TABLE_NAME, NEW.id, 'update', auth.uid(),
      changed, before_v, after_v
    );
  end if;

  return NEW;
end;
$$;

-- 3. 掛 trigger 到三張表(各自先 drop 再 create,冪等)
-- profiles:全欄位審計(角色、停用、姓名、公司)
drop trigger if exists trg_profiles_audit on public.profiles;
create trigger trg_profiles_audit
  after update or delete on public.profiles
  for each row execute function public.audit_trigger_fn();

-- case_work_items:只審計財務相關欄位(避免 sort_path / depth 等內部維護產生雜訊)
drop trigger if exists trg_case_work_items_audit on public.case_work_items;
create trigger trg_case_work_items_audit
  after update or delete on public.case_work_items
  for each row execute function public.audit_trigger_fn(
    'unit_price', 'total_price', 'quantity', 'name',
    'quote_status', 'contract_signed_at', 'contract_note', 'extra_contract_id'
  );

-- extra_contracts:全欄位審計
drop trigger if exists trg_extra_contracts_audit on public.extra_contracts;
create trigger trg_extra_contracts_audit
  after update or delete on public.extra_contracts
  for each row execute function public.audit_trigger_fn();

-- 驗證(跑完後執行確認):
--   select table_name, count(*) from audit_logs group by 1;
--   應該看到三張表的紀錄(若有變更發生過)
