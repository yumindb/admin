# Supabase 搬遷:雪梨 → 東京

把 production Supabase 從 `giclppjyuguylbqvjozx`(ap-southeast-2 雪梨)搬到
`sgeuznnfasrgxlsqzxpc`(ap-northeast-1 東京),縮短台灣使用者到資料庫的距離。
使用者網址 `yumin-admin.vercel.app` 不變,沒人會察覺換了資料庫。

Supabase 區域無法原地更改,只能建新專案搬資料 — 官方也是這個做法。

## 已完成(2026-08-16,Claude 經 MCP 操作)

- [x] 東京專案 `yumin-admin-tokyo` 已建立(組織 YU MIN DB,免費方案 $0)
- [x] Storage bootstrap 已套用:4 個 buckets + 11 條 storage policies,
      與 production 逐條比對一致
- [x] 搬遷 workflow:`.github/workflows/migrate-to-tokyo.yml`(只能手動觸發,
      可重複跑;來源只讀不寫,目標端 ref 有硬編碼防呆)
- [x] 專案資訊(anon key 等)記在 `D:\Evelyn\_secrets\yumin-supabase-tokyo.txt`

## Evelyn 待辦 ①:補兩個 secrets(演練前,一次性)

1. **東京 DB 密碼**:[Dashboard → Settings → Database](https://supabase.com/dashboard/project/sgeuznnfasrgxlsqzxpc/settings/database)
   → Reset database password。
2. **東京 service_role key**:Dashboard → Settings → API keys → `service_role`。
3. 兩個值填進 `D:\Evelyn\_secrets\yumin-supabase-tokyo.txt`,然後設 GitHub secrets:

   ```bash
   gh secret set TOKYO_DB_URL --repo yumindb/admin
   gh secret set TOKYO_SERVICE_ROLE_KEY --repo yumindb/admin
   ```

   (執行後貼值,不會留在 shell 歷史。`TOKYO_DB_URL` 用 **Session pooler URI**,
   格式跟現有 `SUPABASE_DB_URL` 一樣,只是 ref 換成 `sgeuznnfasrgxlsqzxpc`、
   密碼換新的;pooler 域名在 Dashboard → Connect 可直接複製。)

## Evelyn 待辦 ②:production 先跑 migration-2.32(切換前必做)

`daily_logs.photos` / `field_reports.photos` / `log_approvals.signature_url` 還有
21 + 34 + 64 筆存的是**指向雪梨網域的過期 signed URL**(2026-08-16 查)。不清掉就搬,
這些連結會永遠指向舊專案。跑 [`migration-2.32.sql`](migration-2.32.sql)
(冪等,貼 SQL editor 或叫 Claude 經 MCP 執行)。

## 演練(不停機、不動 production,隨時可做)

1. GitHub → Actions → **Migrate to Tokyo (one-off)** → Run workflow,
   `confirm` 欄輸入 `MIGRATE`,兩個開關都保持勾選。
2. Workflow 內建驗證:兩端逐表列數 diff、各 bucket 物件數 diff,不一致會紅燈。
3. (可選)本機把 `.env.local` 三個值換成東京的跑 `npm run dev`,
   或開 Vercel preview 指向東京,實際登入點一遍:
   登入 → 看案件 → 開日誌 → 照片有出來 → 簽名有出來 → PDF 下載。
4. 演練完東京專案先放著。**免費專案 7 天沒活動會 pause**,若離正式切換超過
   一週,切換前到 dashboard 確認狀態(pause 了就按 Restore)。

## 正式切換(挑低使用時段,預留 30–45 分鐘)

1. 前一天公告:「系統 X 時到 X 時維護,期間請勿填寫日誌;完成後**需要重新登入**,
   帳號密碼不變。」(全員會被登出是因為新專案的 JWT secret 不同。)
2. 到點後再跑一次 workflow(`MIGRATE`,全勾)— 把演練後新增的資料補齊。
   跑之前確認沒有人正在填日誌。
3. Vercel → yumin-admin → Settings → Environment Variables,改三個:
   - `NEXT_PUBLIC_SUPABASE_URL` → `https://sgeuznnfasrgxlsqzxpc.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → 東京 anon key(在 `_secrets` 檔裡)
   - `SUPABASE_SERVICE_ROLE_KEY` → 東京 service_role
   (`CRON_SECRET`、LINE 相關不動。)
4. 觸發 redeploy:推一個空 commit 或用 Deploy Hook(**不要按舊 deployment 的
   Redeploy** — 那是重 build 舊 commit,見 Vercel 踩雷紀錄)。
5. Smoke test(四角色抽一兩個):登入 → 案件 → 日誌 → 照片 → 簽名 → PDF →
   打卡 → LINE 通知綁定狀態(`line_bindings` 有搬,綁定應該還在)。
6. 解除公告。

## 切換後(當天~一週內)

- [ ] 本機 `.env.local` 三個值換成東京
- [ ] **備份 workflow 改指東京**(不改的話每天備份的還是舊資料庫!):
  - 東京 Dashboard → Storage → S3 access keys 建一組,更新 GitHub secrets
    `SUPABASE_S3_ACCESS_KEY` / `SUPABASE_S3_SECRET_KEY`,
    `SUPABASE_S3_ENDPOINT` → `https://sgeuznnfasrgxlsqzxpc.supabase.co/storage/v1/s3`,
    `SUPABASE_S3_REGION` → `ap-northeast-1`
  - `SUPABASE_DB_URL` → 換成東京的(跟 `TOKYO_DB_URL` 同值)
  - 手動跑一次 Daily Backup 確認綠燈
- [ ] `docs/PROJECT.md` 資料庫節、`_secrets` 檔案更新 ref 說明
- [ ] MCP 操作對象換成東京專案(每次 `list_projects` 比對 ref 的習慣不變)
- [ ] 觀察 3–7 天沒問題後,把雪梨專案 **pause**(先別刪);再過一個月確認
      R2 備份都來自東京後,才考慮刪除雪梨專案
- [ ] 回頭把 `migrate-to-tokyo.yml` 從 repo 移除或留檔註記已完成

## 回退方案

切換後發現重大問題:把 Vercel 三個環境變數改回雪梨值 + redeploy 即可,
雪梨專案在 pause 之前都完好未動(workflow 對它只讀不寫)。
⚠ 回退會丟失「切換後寫進東京」的資料,所以切換後第一天要盯緊。

## 資料量參考(2026-08-03 量測)

17 張表共 8,225 列;Storage 668 檔 359 MB(daily-photos 556 檔/199MB、
daily-log-pdfs 13 檔/85MB、signatures 95 檔/25MB、fonts 4 檔/50MB)。
24 個帳號。實測 dump+restore 應在 10 分鐘內。
