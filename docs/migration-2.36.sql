-- ==========================================================================
-- Migration 2.36 — 審閱關:審閱人的 RLS + 開關設定 + 清掉雙簽設定
-- ==========================================================================
-- ⚠ 先跑 migration-2.35.sql(加 enum 值)並確認完成,再跑這支 — 同一個
--   transaction 裡新增的 enum 值不能被 policy 使用。
--
-- 內容:
--   1. log_approvals:'review' 關的 INSERT 從 site_supervisor 改給 reviewer
--      (主任複核關從沒啟用過,production 零筆紀錄)
--   2. daily_logs:reviewer 可以 UPDATE 停在 review 關的日誌
--      (approveStageAction / rejectStageAction 要改 status / current_stage;
--       reviewer 不在 logs_office_write 裡,沒這條 policy 會 0 rows 更新失敗)
--   3. app_settings:種入 approval.review_stage_enabled = false(預設關,
--      有審閱人帳號後在人員管理頁打開);刪掉已沒程式在讀的 approval.dual_sign_enabled
--
-- 沒動的(reviewer 靠既有 policy 就夠):
--   - cases / case_work_items / daily_logs / log_approvals / field_reports 的 read_all
--   - profiles:自己讀自己;待簽清單的主任名字走 profiles join —
--     ⚠ profiles_self_read 只開「自己 + office/owner」,reviewer 看待簽清單時
--     主任名字會是 null → 這支順便把 reviewer 加進 profiles 的 SELECT
--     (只讀,不能改別人的 profile)
--   - leave_requests:自己送的假走 applicant_id = auth.uid();reviewer 不簽別人的假
--   - signatures bucket:INSERT 本來就只看 auth.uid() 前綴,任何角色都能傳自己的簽名
--
-- daily_logs.approve_signatures(migration-2.29)欄位保留不刪 — 程式已不再讀寫,
-- 留著無害;真要清等下次整理 schema 再一起。
--
-- 跑法:Supabase SQL Editor 貼上執行。冪等。
-- ==========================================================================

-- 1. log_approvals:review 關給 reviewer
drop policy if exists approvals_review_insert on public.log_approvals;
create policy approvals_review_insert on public.log_approvals
  for insert
  to authenticated
  with check (
    stage = 'review'
    and approver_id = auth.uid()
    and public.current_user_role() = 'reviewer'
  );

-- 2. daily_logs:reviewer 只能動「停在審閱關」的日誌(通過 → approve;退回 → rejected)
drop policy if exists logs_reviewer_stage_update on public.daily_logs;
create policy logs_reviewer_stage_update on public.daily_logs
  for update
  to authenticated
  using (
    public.current_user_role() = 'reviewer'
    and status = 'submitted'
    and current_stage = 'review'
  )
  with check (public.current_user_role() = 'reviewer');

-- 3. profiles:reviewer 可讀全部(待簽清單 / 簽核歷程要顯示主任與簽核人姓名)
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.current_user_role() in ('office_staff','owner','reviewer')
  );

-- 4. app_settings:審閱關開關(預設關);雙簽設定已無程式在讀,刪掉免得誤導
insert into public.app_settings (key, value, description)
values (
  'approval.review_stage_enabled',
  'false'::jsonb,
  '辦公室審核通過後是否先經過審閱人(在系統上簽核、不進 PDF)再交核定人。false = 審核後直接核定。沒有啟用中的審閱人帳號時會自動跳過。'
)
on conflict (key) do nothing;

delete from public.app_settings where key = 'approval.dual_sign_enabled';

-- 通知 PostgREST 重整 schema cache
notify pgrst, 'reload schema';

-- 驗證
select policyname, cmd from pg_policies
  where schemaname = 'public'
    and tablename in ('log_approvals','daily_logs','profiles')
  order by tablename, policyname;
select key, value from public.app_settings order by key;
