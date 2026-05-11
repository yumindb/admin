-- ==========================================================================
-- Migration 2.18 — signatures bucket SELECT 收緊
-- ==========================================================================
-- 為什麼:
--   migration-2.10 把 signatures bucket 翻 private,但 SELECT policy 仍是
--   「authenticated 全讀」— 任何登入者只要知道 path(path 是 `{user.id}/...`),
--   或 createSignedUrls 帶任意路徑,就能讀到別人的簽名 PNG。
--
--   簽名是審計憑證,被別人讀到 = 偽造風險(可截圖或複製成自己的簽名)。
--   雖然員工內部信任,但角色分離(separation of duties)的基礎原則應保留。
--
-- 解法:
--   SELECT 收緊到「只能讀自己的 folder」。
--   伺服器端讀別人的簽名(PDF 產生、approvals/[id] 顯示歷史簽名)走 service-role
--   client,繞 RLS — 不受影響。
--
-- 對 daily-photos / daily-log-pdfs 的決策:
--   2026-05-11 與業主確認:工地主任跨案件可看(主任會到處跑),所以照片 / PDF
--   bucket 維持 authenticated 全讀,不在此 migration 收緊。
--
-- 跑法: Supabase SQL Editor 整份貼上。冪等。
-- ==========================================================================

-- drop 舊 signatures_select(authenticated 全讀)
drop policy if exists signatures_select on storage.objects;

-- 新 signatures_select:只能讀自己的 folder
create policy signatures_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'signatures'
    and name like (auth.uid()::text || '/%')
  );

-- 驗證(跑完後執行確認):
--   select policyname, qual from pg_policies
--   where schemaname='storage' and tablename='objects' and policyname='signatures_select';
--   應該看到 qual 含 `(name ~~ ((auth.uid())::text || '/%'::text))`
