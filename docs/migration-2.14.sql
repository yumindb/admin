-- ==========================================================================
-- Migration 2.14 — 開放 site_supervisor 新增 extra / unsigned 工項
-- ==========================================================================
-- 為什麼:
--   migration-2.10 把 case_work_items 寫入鎖在 office_staff / owner。
--   2.13 升等合約外/未簽約後,工地主任在 /logs/new 填日誌時要能即時
--   新增臨時項 — 這條被 RLS 擋住("new row violates row-level security
--   policy for table case_work_items")。
--
-- 解法:
--   加一條 INSERT-only policy,給 site_supervisor 限定只能 insert
--   item_type IN ('extra','unsigned') 的 row。
--   - 不開 UPDATE / DELETE → 報價、刪除仍只有 office/owner 能做
--   - 不能 insert section/item/spec/manual → 標單工項仍由 office 控管
--   PostgreSQL 多條 INSERT policy 是 OR 邏輯,因此 office/owner 仍走原 work_items_write_office。
--
-- 跑法: Supabase SQL Editor 整份貼上。冪等(drop if exists 後 create)。
-- ==========================================================================

drop policy if exists work_items_supervisor_insert_extra on public.case_work_items;

create policy work_items_supervisor_insert_extra on public.case_work_items
  for insert
  to authenticated
  with check (
    public.current_user_role() = 'site_supervisor'
    and item_type in ('extra', 'unsigned')
  );

-- 通知 PostgREST 重整 schema cache(讓上面 policy 立刻生效,不用等 5 min auto-refresh)
notify pgrst, 'reload schema';

-- 驗證
select policyname, cmd, qual, with_check
  from pg_policies
  where schemaname = 'public' and tablename = 'case_work_items'
  order by policyname;
