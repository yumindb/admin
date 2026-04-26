-- ==========================================================================
-- Fix #3 (the real one): auth.users token 欄位要空字串不能 NULL
-- ==========================================================================
-- Supabase log 揭曉真正原因:
--   error finding user: sql: Scan error on column index 3,
--   name "confirmation_token": converting NULL to string is unsupported
--
-- 新版 Supabase 的 auth.users 對 confirmation_token / recovery_token /
-- email_change_token_new / email_change / phone_change / phone_change_token /
-- email_change_token_current / reauthentication_token 等欄位的處理方式變了,
-- GoTrue 內部 scan 期望非 NULL string,我的 seed-accounts.sql 沒帶這些欄位 →
-- 預設 NULL → GoTrue 一讀就 panic → 回 "Database error querying schema"。
--
-- 此腳本把現有 3 個帳號的 NULL token 補成 ''。冪等。
-- ==========================================================================

update auth.users
set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change               = coalesce(phone_change, ''),
  phone_change_token         = coalesce(phone_change_token, ''),
  reauthentication_token     = coalesce(reauthentication_token, '')
where email like '%@yumin.local';

-- 驗證:應顯示 3 行,所有 *_token 欄位都不是 null
select
  email,
  confirmation_token is null         as ct_null,
  recovery_token is null             as rt_null,
  email_change_token_new is null     as ectn_null,
  email_change_token_current is null as ectc_null,
  phone_change is null               as pc_null,
  reauthentication_token is null     as reauth_null
from auth.users
where email like '%@yumin.local';
