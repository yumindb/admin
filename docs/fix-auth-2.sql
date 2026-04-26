-- ==========================================================================
-- Fix #2: 補上 supabase_auth_admin 對 enum type 與 public schema 的廣泛權限
-- ==========================================================================
-- fix-auth.sql 跑完仍然「Database error querying schema」, 因為 GoTrue 在
-- introspect public schema 時會走過所有 referenced types。我們的自定 enums
-- (user_role, case_status, work_item_type, ...) 沒給 supabase_auth_admin
-- USAGE 權限,GoTrue 解析 profiles 表的 role 欄位類型時就 fail。
--
-- 此腳本給足所有需要的權限。冪等。
-- ==========================================================================

-- 1. 自定 enum types — grant USAGE 給所有需要的 role
grant usage on type public.user_role           to supabase_auth_admin, authenticated, anon, service_role;
grant usage on type public.case_status         to supabase_auth_admin, authenticated, anon, service_role;
grant usage on type public.work_item_type      to supabase_auth_admin, authenticated, anon, service_role;
grant usage on type public.tender_import_status to supabase_auth_admin, authenticated, anon, service_role;
grant usage on type public.log_status          to supabase_auth_admin, authenticated, anon, service_role;
grant usage on type public.approval_stage      to supabase_auth_admin, authenticated, anon, service_role;
grant usage on type public.approval_decision   to supabase_auth_admin, authenticated, anon, service_role;

-- 2. public schema 與所有現有物件 — 廣泛 grant 確保 GoTrue 能 introspect
grant usage on schema public to supabase_auth_admin;
grant select on all tables in schema public to supabase_auth_admin;
grant select on all sequences in schema public to supabase_auth_admin;
grant execute on all functions in schema public to supabase_auth_admin;

-- 3. 確認 trigger function 仍 owned by postgres (SECURITY DEFINER 才能 bypass RLS)
alter function public.handle_new_user() owner to postgres;

-- 4. 驗證
select
  t.typname as enum_name,
  has_type_privilege('supabase_auth_admin', t.oid, 'USAGE') as can_use
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public' and t.typtype = 'e'
order by t.typname;
