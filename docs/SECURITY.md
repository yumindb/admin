# 資安 / 效能健檢紀錄

> **2026-09-26 全站健檢**:對照正式站實際的 policy / 權限 / trigger(Supabase MCP 唯讀查)、
> Supabase 安全與效能顧問、Vercel 錯誤紀錄,加上程式碼四組平行稽核(server action 授權、
> RLS / storage、效能、設定與相依套件)。下面分成「已修好」「要 Evelyn 處理」「建議的第二批」。

## 已修好

### 資料庫(migration-2.38,2026-09-26 已套正式站並驗證)

| 等級 | 問題 | 修法 |
|---|---|---|
| 嚴重 | 任何登入的人都能把自己的 `profiles.role` 改成 owner(policy 只檢查「是自己那列」、欄位全開、沒 trigger) | authenticated 只能改自己的 `full_name`、`phone`;角色 / 停用走 service role(/staff 本來就是) |
| 高 | `handle_new_user` 用註冊者自帶的 `user_metadata.role` 當角色,且 Supabase 公開註冊是開的(目前靠 email 驗證擋) | 新帳號一律建成**停用的現場人員**,/staff 會用 service role 覆寫成正確角色並啟用 |
| 高 | daily-log-pdfs bucket 有 3 條 POC 全開 policy:任何登入者能覆蓋已核定的 PDF、下載所有 PDF(內含大家的簽名) | 拿掉(程式讀寫 PDF 全走 service role) |
| 高 | 日誌狀態沒守門:主任能把自己的日誌改成 approved、改或刪已核定的;助理能跳過核定人 | `trg_daily_logs_guard`:只有 owner 能核定;主任不能動已核定、只能刪草稿、只能送進 audit 關 |
| 中 | 停用的帳號在 JWT 過期前(最長 1 小時)資料庫層仍有權限 | `current_user_role()` 加 `is_active` |
| 低 | trigger / event trigger function 對 anon 開放 EXECUTE、`touch_updated_at` 沒鎖 search_path、bucket 沒大小 / 類型上限 | 收斂權限、鎖 search_path、照片 15MB image/*、簽名 5MB png/jpeg |

驗證方式:以模擬角色(`set local role authenticated` + JWT claims)在 transaction 裡實測後 rollback —
升權、主任自己核定、主任改 / 刪已核定、助理跳過核定人**全部擋下**;改姓名、主任編輯送出中的日誌、
助理審核、撤回核定、核定人核定**都照常**。原始定義存在 `migration-2.38-rollback.sql`。

### 程式

- **登入後的 `next` 導向可被繞到外站**(`/\evil.com`、`/%5C…`)→ `lib/auth/safe-next.ts` 用 URL 解析比對 origin,有單元測試
- **任何人都能讓老闆登不進來**:錯 3 次就鎖整個帳號,不分來源 → 改成「同一 IP 錯 3 次鎖該 IP」+「不分來源錯 20 次才鎖整個帳號」
- **簽核可以拿別人的簽名圖**(log_approvals 大家都讀得到簽名路徑)→ 核定 / 審核 / 加簽 / 填表簽名都只收簽核人自己資料夾的檔
- 簽核、人員管理、日誌送出的授權改走共用 `tryGetActor()`(以前各自 `getUser()`,沒擋停用帳號)
- 全站安全標頭:`X-Frame-Options: DENY`、`nosniff`、`Referrer-Policy`、`Permissions-Policy`、`X-Robots-Tag: noindex`,拿掉 `X-Powered-By`
- `docs/seed-accounts.sql` 的明文種子密碼換成佔位字(**舊密碼仍在公開的 git 歷史,一定要改密碼,見下方**)
- 本機開發伺服器只綁 127.0.0.1(以前整個區網都連得到,而且用的是正式站金鑰)

### 正確性 bug(順手修)

- **清孤兒照片的排程會誤刪照片**:沒分頁,日誌或回報超過 1000 筆後,第 1001 筆以後的照片會被當孤兒刪掉,
  凌晨備份的 rclone sync 再把 R2 上的備份一起刪 → 改用 `fetchAllRows`,並加保險絲(一次要刪超過 20% 就停手)
- **工項累計報表只算前 1000 筆工項**(正式站進行中案件已有 6,800 多筆)→ 分頁撈完
- **「今天」用 UTC 算**:台灣早上 8 點前的打卡在打卡頁看不到、儀表板把 8 點前打卡的主任列成「還沒打卡」、
  月初統計漏掉 1 號凌晨 → `lib/datetime.ts` 的 `startOfTodayTaipei()` / `startOfMonthTaipei()`
- **「JWT issued at future」錯誤頁**(正式站 7 天內 3 位使用者):token 剛換新時時鐘差一點點,
  以前立刻重試必定再失敗 → 隔 0.8 秒、1.6 秒再試

### 效能

- proxy 與 `getActor()` 改用 `getClaims()`:專案是 ES256 非對稱金鑰,JWT 在本機驗章,
  **每次換頁少打 2 趟 Supabase Auth server**(/login 仍用 `getUser()`,避免停用帳號無限導向)
- 說明書、影片、manifest 不再經過 proxy 驗身分
- 打卡頁、新增回報頁每次打開都會多 render 一整輪(離線佇列是空的也 refresh)→ 有補送才 refresh
- 7 個頁面、照片上傳等 action 自己多呼叫 `getUser()` → 共用 `tryGetActor()` / `requireRole()` 的結果
- 現場回報列表、日誌表單的待併回報縮圖加 `loading="lazy"`(以前一進頁面就抓 90 天內全部原圖)
- 4 條索引(migration-2.39):日誌 案件+日期、主任+日期、簽核人+時間、工項 import_id

## 要 Evelyn 處理(需要後台權限或要先跟 Phil 講)

1. 🔴 **改種子帳號密碼**:`owner`(= Phil 的帳號)、`office`、`supervisor`、`field` 都曾用 `docs/seed-accounts.sql`
   的密碼,而 repo 是公開的,等於任何人都能從登入頁登入。至少 9/13 時 `office` 還在用。
   到 /staff 用「重設密碼」改掉(Phil 的先跟他講);`Test-*` 開頭沒在用的帳號直接停用。
   想確認還有誰用那組密碼,可在 SQL Editor 跑(把 `<種子密碼>` 換成舊檔案裡的值):
   ```sql
   select split_part(u.email,'@',1) as username, p.full_name, p.role, p.is_active
     from auth.users u join public.profiles p on p.id = u.id
    where u.encrypted_password = extensions.crypt('<種子密碼>', u.encrypted_password);
   ```
2. 🔴 **GitHub repo `yumindb/admin` 改成 private**(Settings → General → Danger Zone)。公開內容包含所有 RLS 設計、
   專案 ref、客戶的標單範例、Actions 執行紀錄。
3. 🟠 **Supabase → Authentication**:關掉「Allow new users to sign up」(/staff 用 admin API 建帳號不受影響);
   開啟 Leaked password protection;最短密碼建議改 8 碼(程式端目前擋 6 碼)。
4. 🟠 **GitHub Actions 加固**:各 workflow 加 `permissions:`;`run-migration.yml` 的 `${{ inputs.file }}` 改用 env 傳入
   (現在可注入指令);`dawidd6/action-send-mail` 改用 commit SHA 釘版本;`migrate-to-tokyo.yml` 與 `TOKYO_*` secrets
   已完成任務,建議刪除(它現在指向正式站,只剩來源檢查擋著)。
5. 🟠 **Next.js 16.2.4 → 16.3.x**:`npm audit` 列 25 個 advisory(DoS、proxy 繞過、快取污染;頁面與 action 都有自己驗權,
   proxy 繞過影響有限)。建議獨立一輪升級 + 完整回歸。
6. 🟡 `xlsx` 0.18.5 有兩個高風險漏洞、npm 上沒有修正版;只在瀏覽器解析辦公室上傳的標單,
   風險是「外部寄來的惡意標單讓分頁卡死」。可改裝 SheetJS 官方 CDN 的 0.20.3。
7. 🟡 本機 `_work/seed-demo-launch.mjs` 會無條件清空 12 張表、`_work/wipe-demo-data.mjs` 只要 `--yes` —
   `.env.local` 指的是正式站。不用了就刪掉,要留就加「輸入 project ref 才執行」的防呆。
8. 🟡 雪梨舊專案(`giclppjyuguylbqvjozx`)仍是一份完整舊資料,照原計畫刪除。

## 建議的第二批(還沒做)

### 資料庫防線(migration-2.40 草案,動手前先跟 Phil 確認哪些要擋)

目前這些都只靠 server action 擋、資料庫層沒擋。**現階段的緩解**:瀏覽器端沒有用到 Supabase client,
anon key 不在前端程式裡,一般使用者拿不到直接打 API 的鑰匙。**但只要哪天加了瀏覽器直連 Supabase
(例如照片直傳 storage),以下全部變成可利用** — 那之前一定要先做完:

- 請假:申請人可以把自己的假單改成 approved;簽核鏈可自己亂填
- 打卡:可以自己插入任意時間、任意座標、`source = manual` 的打卡紀錄
- 簽核紀錄:主任可以在別人的日誌插「填表簽名」紀錄;各關的紀錄不檢查日誌目前在哪一關
- `using (true)` 的讀取 policy 改成「要是啟用中的帳號」
- 現場人員看得到所有工項單價、追加合約金額、所有人的打卡 GPS

### 效能(依影響排序)

1. 照片上傳是**一張一張排隊**(server action 一次只跑一個)→ 改成瀏覽器拿簽名上傳網址後並行直傳(需先做上面的 DB 防線)
2. 核定一份日誌要連打 4 個 server action → 合併成一個
3. `/approvals/[id]` 約 10 個查詢排隊跑、每次撈整個案件的工項 → 平行化 + 改 count
4. 儀表板、案件總覽把全部日誌 / 工項撈回來在 JS 算 → 改成 SQL 彙總
5. 列表都用 1600px 原圖當縮圖 → 上傳時多存一張 400px 縮圖
6. 日誌 PDF 平均 4.5MB、最大 38MB(照片原尺寸塞進 PDF)→ 產 PDF 時縮圖
7. action 裡 `revalidatePath` 又在前端 `router.refresh()`,同一頁 render 兩次
8. `jszip`、lightbox、簽名板等大套件改成用到才載入

## 系統監控

2026-09-26 起有「常用操作 / 慢請求 / 錯誤紀錄 / 登入紀錄」四頁(`/system`),只給
`SYSTEM_ADMIN_USERNAMES` 名單上的帳號看。架構見 [`PROJECT.md`](PROJECT.md) 的「系統監控」節。
下次健檢可以直接從錯誤紀錄與慢請求開始看。
