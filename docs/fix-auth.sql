-- ==========================================================================
-- Fix: "Database error querying schema" 登入錯誤
-- ==========================================================================
-- 原因:
--   原本 schema.sql 內的 handle_new_user trigger 用了 `search_path = public`,
--   且函數沒有顯式 grant 給 supabase_auth_admin。Supabase GoTrue 在登入時
--   會做 schema introspection,遇到無法解析的函數定義會回傳此錯誤。
--
-- 解法 (Supabase 官方建議的 canonical 寫法):
--   1. trigger function 用 `search_path = ''` (空) + 完全 schema-qualified
--   2. 明確 grant supabase_auth_admin 對 public 的權限
--   3. backfill 任何 auth.users 沒對應 profile 的資料
--
-- 跑完此腳本後重新登入即可。schema.sql 也已同步更新,未來新環境直接跑 schema.sql
-- 不會再有此問題。
-- ==========================================================================

-- 1. 重建 trigger function (canonical pattern)
drop trigger if exists on_auth_user_created on auth.users;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(
      (new.raw_user_meta_data->>'role')::public.user_role,
      'office_staff'::public.user_role
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- 2. Grant supabase_auth_admin 對 public schema 的權限
--    GoTrue 用此 role 做 schema introspection
grant usage on schema public to supabase_auth_admin;
grant all on public.profiles to supabase_auth_admin;
grant execute on function public.handle_new_user() to supabase_auth_admin;


-- 3. Backfill: 如果 seed-accounts.sql 跑了但 trigger 沒成功建 profile,補建
insert into public.profiles (id, full_name, role)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  coalesce(
    (u.raw_user_meta_data->>'role')::public.user_role,
    'office_staff'::public.user_role
  )
from auth.users u
where u.id not in (select id from public.profiles)
on conflict (id) do nothing;


-- 4. 驗證 — 應該看到 3 行 (office_staff / owner / site_supervisor)
select p.full_name, p.role, p.company, u.email
from public.profiles p
join auth.users u on u.id = p.id
where u.email like '%@yumin.local'
order by p.role;
