-- ==========================================================================
-- Migration 2.10 — Role-based RLS（取代 POC wide-open）
-- ==========================================================================
-- 用途:
--   把 schema.sql 設下的 `poc_authenticated_all`(任何人都能讀寫所有資料)
--   改為 role-based RLS。三家公司**不做資料隔離**(Phil 確認共用),
--   只用角色控管寫入權與部分敏感欄位。
--
-- 角色矩陣:
--   - field_assistant : 只能讀;不能寫 daily_logs / cases / case_work_items;
--                       可寫 field_reports(自己的)。
--   - site_supervisor : 讀 cases / work_items / logs;寫自己 supervisor_id 的
--                       daily_logs;不可改 cases / work_items;可寫 field_reports;
--                       可在 review 階段插 log_approvals。
--   - office_staff    : 讀寫 cases / work_items / tender_imports;讀寫 daily_logs;
--                       可在 audit 階段插 log_approvals;可改 profiles.role/is_active。
--   - owner           : 同 office_staff,額外可在 approve 階段插 log_approvals。
--
-- daily_log_revisions: 只開 INSERT(audit log 不可竄改),修 migration-2.9 的
--                      `for all` 漏洞。
--
-- 跑法: Supabase SQL Editor 整份貼上執行。冪等(drop if exists 後 create)。
-- ==========================================================================

-- ==========================================================================
-- helper: current_user_role()
-- ==========================================================================
-- 用 SECURITY DEFINER + stable + search_path = '' 拿當前 user 的 role,
-- 避免每張表 policy 內都重撈 profiles + RLS 遞迴。
-- stable → planner 可在同一個 query 內 cache 結果。
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid()
$$;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_role() to supabase_auth_admin;


-- ==========================================================================
-- 清掉 schema.sql / 後續 migration 留下的舊 policy
-- ==========================================================================
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles','cases','tender_imports','case_work_items',
        'daily_logs','log_approvals','field_reports','daily_log_revisions'
      )
      and policyname in (
        'poc_authenticated_all',
        'profiles_self_read','profiles_self_update',
        'profiles_admin_read','profiles_admin_update',
        'cases_read_all','cases_write_office',
        'tender_imports_read_all','tender_imports_write_office',
        'work_items_read_all','work_items_write_office',
        'logs_read_all','logs_supervisor_write','logs_office_write',
        'approvals_read_all','approvals_review_insert','approvals_audit_insert',
        'approvals_approve_insert','approvals_fill_insert',
        'reports_read_all','reports_author_write','reports_office_merge',
        'revisions_read_all','revisions_insert'
      )
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;


-- ==========================================================================
-- 1. profiles
-- ==========================================================================
-- 設計理由:
--   - 自己永遠看得到自己(登入後就要拿 role / full_name)
--   - office_staff / owner 為帳號管理者,看全部 + 可改 role / is_active
--   - 自己可改 full_name / phone(不能改 role)
alter table public.profiles enable row level security;

-- SELECT: 自己 + admin (office_staff / owner) 看全部
create policy profiles_self_read on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.current_user_role() in ('office_staff','owner')
  );

-- UPDATE: 自己改自己(不含 role / is_active),admin 改全部
-- 註: 欄位層級的「禁改 role」在 server action 控制 — RLS 只擋整 row。
create policy profiles_self_update on public.profiles
  for update
  to authenticated
  using (
    id = auth.uid()
    or public.current_user_role() in ('office_staff','owner')
  )
  with check (
    id = auth.uid()
    or public.current_user_role() in ('office_staff','owner')
  );

-- INSERT/DELETE: 一律不開(profiles 由 auth trigger 建,不該手動)


-- ==========================================================================
-- 2. cases
-- ==========================================================================
-- 設計理由:
--   - 三公司共用,所有登入者都能看(不做 company filter)
--   - 寫權限給 office_staff / owner;site_supervisor / field_assistant 只讀
alter table public.cases enable row level security;

create policy cases_read_all on public.cases
  for select
  to authenticated
  using (true);

create policy cases_write_office on public.cases
  for all
  to authenticated
  using (public.current_user_role() in ('office_staff','owner'))
  with check (public.current_user_role() in ('office_staff','owner'));


-- ==========================================================================
-- 3. tender_imports
-- ==========================================================================
-- 設計理由: 跟 cases 同邏輯 — 所有人讀,只有 office/owner 寫
alter table public.tender_imports enable row level security;

create policy tender_imports_read_all on public.tender_imports
  for select
  to authenticated
  using (true);

create policy tender_imports_write_office on public.tender_imports
  for all
  to authenticated
  using (public.current_user_role() in ('office_staff','owner'))
  with check (public.current_user_role() in ('office_staff','owner'));


-- ==========================================================================
-- 4. case_work_items
-- ==========================================================================
-- 設計理由: 跟 cases 同邏輯。日誌會 join 這張表,supervisor 必須讀得到。
alter table public.case_work_items enable row level security;

create policy work_items_read_all on public.case_work_items
  for select
  to authenticated
  using (true);

create policy work_items_write_office on public.case_work_items
  for all
  to authenticated
  using (public.current_user_role() in ('office_staff','owner'))
  with check (public.current_user_role() in ('office_staff','owner'));


-- ==========================================================================
-- 5. daily_logs
-- ==========================================================================
-- 設計理由:
--   - 所有登入者可讀(三公司共用,不做 company filter)
--   - field_assistant 一律不可寫
--   - site_supervisor 只能寫自己 supervisor_id 的 row
--   - office_staff / owner 可寫全部(後送編輯)
--   - daily_logs 的 status / current_stage 由 server action 守(approved 不可改)
alter table public.daily_logs enable row level security;

create policy logs_read_all on public.daily_logs
  for select
  to authenticated
  using (true);

-- supervisor 只能動自己掛名的;不限制 status(草稿 / 退回 / 送出後編輯都走這條),
-- approved 由 server action 擋。
create policy logs_supervisor_write on public.daily_logs
  for all
  to authenticated
  using (
    public.current_user_role() = 'site_supervisor'
    and supervisor_id = auth.uid()
  )
  with check (
    public.current_user_role() = 'site_supervisor'
    and supervisor_id = auth.uid()
  );

-- office_staff / owner 可改任意 daily_logs(送出後編輯、修錯字)
create policy logs_office_write on public.daily_logs
  for all
  to authenticated
  using (public.current_user_role() in ('office_staff','owner'))
  with check (public.current_user_role() in ('office_staff','owner'));


-- ==========================================================================
-- 6. log_approvals
-- ==========================================================================
-- 設計理由:
--   - 所有登入者可讀(簽核歷程透明)
--   - INSERT 嚴格綁 stage × role:
--       fill    → site_supervisor / owner(填表人簽名,saveLogAction 寫入)
--       review  → site_supervisor
--       audit   → office_staff
--       approve → owner
--   - 不開 UPDATE / DELETE(簽核紀錄不可竄改)
alter table public.log_approvals enable row level security;

create policy approvals_read_all on public.log_approvals
  for select
  to authenticated
  using (true);

create policy approvals_fill_insert on public.log_approvals
  for insert
  to authenticated
  with check (
    stage = 'fill'
    and approver_id = auth.uid()
    and public.current_user_role() in ('site_supervisor','owner')
  );

create policy approvals_review_insert on public.log_approvals
  for insert
  to authenticated
  with check (
    stage = 'review'
    and approver_id = auth.uid()
    and public.current_user_role() = 'site_supervisor'
  );

create policy approvals_audit_insert on public.log_approvals
  for insert
  to authenticated
  with check (
    stage = 'audit'
    and approver_id = auth.uid()
    and public.current_user_role() = 'office_staff'
  );

create policy approvals_approve_insert on public.log_approvals
  for insert
  to authenticated
  with check (
    stage = 'approve'
    and approver_id = auth.uid()
    and public.current_user_role() = 'owner'
  );


-- ==========================================================================
-- 7. field_reports
-- ==========================================================================
-- 設計理由:
--   - 所有人可讀(主任填日誌時要看全部 pending 的回報)
--   - 作者可寫自己的(field_assistant / site_supervisor / owner 都可發)
--   - office_staff / site_supervisor / owner 也可改 status(merge / archive)
alter table public.field_reports enable row level security;

create policy reports_read_all on public.field_reports
  for select
  to authenticated
  using (true);

-- 作者寫自己的(insert + update + delete 自己的 pending)
create policy reports_author_write on public.field_reports
  for all
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- 主任 / 助理 / 老闆可改任意 field_report(主要用途: 翻 status 為 merged)
create policy reports_office_merge on public.field_reports
  for update
  to authenticated
  using (public.current_user_role() in ('site_supervisor','office_staff','owner'))
  with check (public.current_user_role() in ('site_supervisor','office_staff','owner'));


-- ==========================================================================
-- 8. daily_log_revisions
-- ==========================================================================
-- 設計理由:
--   - audit log 不可竄改 — 修 migration-2.9 的 `for all` 漏洞
--   - SELECT: 所有登入者可讀(顯示在日誌詳情頁)
--   - INSERT: 任一登入者(server action 已守 role,RLS 再加一層 editor_id 必須是自己)
--   - UPDATE / DELETE: 一律不開
alter table public.daily_log_revisions enable row level security;

create policy revisions_read_all on public.daily_log_revisions
  for select
  to authenticated
  using (true);

create policy revisions_insert on public.daily_log_revisions
  for insert
  to authenticated
  with check (
    editor_id = auth.uid()
    and public.current_user_role() in ('site_supervisor','office_staff','owner')
  );


-- ==========================================================================
-- 9. Storage 轉 private + 收緊 policy(原 docs/storage.sql 是 public + 寬鬆)
-- ==========================================================================
-- 設計理由:
--   - daily-photos / signatures 從 public 翻 private,前端改用 signed URL(5 min)
--   - daily-log-pdfs 已是 private,這次跟上
--   - INSERT path 必須以 `auth.uid() || '/'` 開頭(防偽造路徑)
--   - SELECT 給 authenticated(因 RLS 在 logs / reports 層擋)
--   - UPDATE / DELETE 限定自己 user folder

-- 翻 private
update storage.buckets
  set public = false
  where id in ('daily-photos','signatures');

-- 清舊 policy
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in (
        'poc_daily_photos_read','poc_daily_photos_write',
        'poc_signatures_read','poc_signatures_write',
        'daily_photos_select','daily_photos_insert',
        'daily_photos_update','daily_photos_delete',
        'signatures_select','signatures_insert',
        'signatures_update','signatures_delete'
      )
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- daily-photos
create policy daily_photos_select on storage.objects
  for select
  to authenticated
  using (bucket_id = 'daily-photos');

create policy daily_photos_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'daily-photos'
    and name like (auth.uid()::text || '/%')
  );

create policy daily_photos_update on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'daily-photos'
    and name like (auth.uid()::text || '/%')
  )
  with check (
    bucket_id = 'daily-photos'
    and name like (auth.uid()::text || '/%')
  );

create policy daily_photos_delete on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'daily-photos'
    and name like (auth.uid()::text || '/%')
  );

-- signatures
create policy signatures_select on storage.objects
  for select
  to authenticated
  using (bucket_id = 'signatures');

create policy signatures_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'signatures'
    and name like (auth.uid()::text || '/%')
  );

create policy signatures_update on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'signatures'
    and name like (auth.uid()::text || '/%')
  )
  with check (
    bucket_id = 'signatures'
    and name like (auth.uid()::text || '/%')
  );

create policy signatures_delete on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'signatures'
    and name like (auth.uid()::text || '/%')
  );


-- ==========================================================================
-- 10. 驗證
-- ==========================================================================
-- 跑完後可驗證:
--   select schemaname, tablename, policyname from pg_policies
--   where schemaname in ('public','storage') order by tablename, policyname;
--
--   select id, public from storage.buckets where id in ('daily-photos','signatures');
