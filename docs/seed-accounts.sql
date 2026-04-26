-- ==========================================================================
-- POC 帳號建立 — 在 Supabase SQL Editor 執行
-- ==========================================================================
-- 此腳本建立 3 個帳號:office_staff / site_supervisor / owner
-- 密碼統一為 'yumin1234'(POC 階段,正式版改用邀請流程)
--
-- ⚠ 此腳本依賴 schema.sql 已先執行(profiles 表 + handle_new_user trigger)。
-- 執行後,profiles 會由 trigger 自動補上 role / full_name。
--
-- ⚠ 重要:必須顯式設 confirmation_token / recovery_token 等為 '' (空字串),
-- 不可省略讓它預設 NULL,否則 GoTrue 讀 row 時會 panic 回
-- "Database error querying schema"。詳見 docs/fix-auth-3.sql。
-- ==========================================================================

-- 為了能反覆執行,先刪掉現有同 email 的測試帳號(連帶刪 profiles)
delete from auth.users where email in (
  'office@yumin.local',
  'supervisor@yumin.local',
  'owner@yumin.local'
);

-- ----- 1. 辦公室助理 -----
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'office@yumin.local',
  crypt('yumin1234', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name','辦公室助理','role','office_staff'),
  now(),
  now(),
  '', '', '', '', '', '', '', ''
);

-- ----- 2. 工地主任 -----
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'supervisor@yumin.local',
  crypt('yumin1234', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name','工地主任','role','site_supervisor'),
  now(),
  now(),
  '', '', '', '', '', '', '', ''
);

-- ----- 3. 老闆 -----
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'owner@yumin.local',
  crypt('yumin1234', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name','Phil 老闆','role','owner'),
  now(),
  now(),
  '', '', '', '', '', '', '', ''
);

-- 驗證
select p.full_name, p.role, p.company, u.email
from public.profiles p
join auth.users u on u.id = p.id
where u.email in ('office@yumin.local','supervisor@yumin.local','owner@yumin.local')
order by p.role;
