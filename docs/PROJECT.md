# Yu Min Admin — 專案指令

裕民工務內部工程管理系統。Claude Code 進入此資料夾請先讀此檔再開始工作。

> **最後大更新：2026-07-04。** 本檔描述「現在的系統」；歷史決策的 why 在
> [`docs/decisions.md`](decisions.md)，DB 變更順序在 [`docs/MIGRATIONS.md`](MIGRATIONS.md)。
> 規劃任何架構改動前，這三份都要讀。

## 專案概覽

- **客戶**：裕民工務（三家公司共用一個 instance，員工跨公司）
- **顧問/開發者**：Evelyn @ Still Lab（兼職 + AI 協作）
- **狀態**：Phase 1-2 已上線試用中（production: https://yumin-admin.vercel.app）
- **業務目標**（所有功能決策回到這六件事）：
  1. 工人（現場人員）方便回報現場狀況
  2. 工地主任方便寫施工日誌
  3. 辦公室助理順利管理與追蹤案件
  4. 老闆 Phil 看了滿意（dashboard、簽核順手）
  5. 不漏收臨時／追加工作的錢（合約外、未簽約、追加合約流程）
  6. 提升裕民整體工作效率

## 技術棧

- **Next.js 16**（App Router、React 19、Turbopack）+ TypeScript
  - ⚠ Next 16 的 middleware 慣例改名 `proxy.ts`；寫 code 前先讀 `node_modules/next/dist/docs/`（見 AGENTS.md）
- **Tailwind CSS v4** + **shadcn/ui**（Radix + Lucide）
- **Supabase**（PostgreSQL 17 + Auth + Storage）— production instance 在**裕民自己的帳號**下
- **xlsx**（標單 parser）、**react-signature-canvas**（簽名）、**react-hook-form + zod**（表單）
- **leaflet + OpenStreetMap**（案件座標 picker，vanilla 動態 import）
- **@react-pdf/renderer**（核定後日誌 PDF）
- **vitest**（`npm run test`）；CI 跑 lint + test（`.github/workflows/ci.yml`）

## 角色（5 種，enum `user_role`）

| role | 主要裝置 | 首頁 | 做什麼 |
|---|---|---|---|
| `field_assistant` 現場人員 | 手機 | /field-reports | 現場回報、打卡、請假；主任請假時被指定為**代理人**就能代寫、送出施工日誌 |
| `site_supervisor` 工地主任 | 手機 | /logs | 施工日誌、打卡、現場回報、請假、簽現場人員的假單 |
| `office_staff` 辦公室助理 | 桌機 | /dashboard | 開案、標單匯入、審核、報表、帳號管理、追加合約 |
| `reviewer` 審閱人（2026-09） | 桌機+手機 | /approvals | **加簽**辦公室審核通過的日誌（跟流程無關、簽名不進 PDF）；日誌／案件唯讀；請假直接給 owner 簽 |
| `owner` 老闆 Phil | 手機+桌機 | /dashboard | 核定簽名、dashboard、報表、帳號管理 |

- 「系統管理員」角色**沒有做**：帳號管理放在 `/staff`，office_staff / owner 皆可操作。
- 「監工」角色（提案 #14/#22）**沒有做**，若業主重提再議。
- **主任跨案件是設計不是漏洞**：裕民 2026-05 拍板主任可看所有案件、對任何案件建日誌
  （daily_logs / cases read-all）。但 signatures bucket 仍隔離（只能讀自己 folder）。

## 簽核流程（三關，每關都要手寫簽名）

```
draft →[主任填表+簽名 fill]→ submitted+audit
     →[辦公室審核 audit]→ submitted+approve
     →[核定人簽名 approve ×1]→ approved（自動產 PDF）
     →[任一關退回]→ rejected →[修正重送]→ 回到 audit

（旁支，不在鏈上）審閱人「加簽」：audit 通過後（核定中或已核定）隨時可簽，
  寫一筆 stage='review' 的 log_approvals，daily_logs 不動、不擋核定、不進 PDF
```

- role ↔ stage 對照集中在 `lib/approvals/stages.ts`（`STAGE_FOR_ROLE`），不要再各檔抄一份。
  主任與審閱人都沒有自己的關卡（fill 的簽名寫在 saveLogAction；加簽走 `endorseLogAction`）。

- **退回後的重送有兩條路**（2026-08 修，業主回報「改完只能存檔、送不出去」）：
  - **主任本人**：`/logs/[id]/edit` 是 classic 模式 → 改完按「送出核定」，要**重新手寫簽名**
    （會再寫一筆 `fill` 的 log_approvals）。同頁的「暫存修改」不會把日誌打回 `draft`，
    狀態維持 `rejected`（以前會降級成 draft，整份從所有人清單消失且不發通知）。
  - **辦公室助理 / 核定人**：post-submission 模式 → 「存檔並重新送出」直接把日誌送回
    `submitted` + `audit`，不需要重簽（與「助理可改簽核中日誌」一致）。同時更新
    `submitted_at`（「本輪」靠 submitted_at 判定），
    並發 `log_resubmitted` LINE 通知。內容沒動也照送 — 按鈕語意就是重送。

- **核定是單簽**（2026-09-09 業主拍板）：一位核定人簽完就 `approved` + 產 PDF。
  2026-07 的「雙簽」構想整套拿掉（第二位核定人始終沒到職，production 從 2026-08-04
  起就是單簽）。`daily_logs.approve_signatures` 欄位留著但程式已不讀寫。
- **審閱人加簽**（2026-09-13 業主定案；09-09 曾做成閘門式「審閱關」，同週改掉）：
  `reviewer` 在日誌通過辦公室審核後（`canEndorseLog`：核定中或已核定）隨時可以加簽，
  `endorseLogAction` 只寫一筆 stage='review' 的 `log_approvals`，**daily_logs 完全不動、
  不擋核定、不發 LINE**；同一輪只能簽一次（退回重送 / 撤回核定後可再簽）。
  **簽名與意見都不進 PDF**（`omitReviewStage()`）；有寫意見才發站內消息。
  審閱人的 `/approvals` 是「加簽」清單（`endorse-list.tsx`：audit 已過、這一輪還沒簽的最近 100 份，
  沒有紅色待辦數字），點進去是同一個簽核頁但只有簽名 + 意見（`ApprovalActions mode="endorse"`）。
  沒有任何開關；`app_settings` 目前是空表。`review` 這個 stage 值 2026-09 前是「主任複核」，
  production 從沒用過。
  ⚠ **UI 文案一律寫「核定人」不寫「老闆」**（2026-08 業主要求，畫面上不點名老闆）。

- 統一走 `approveStageAction` / `rejectStageAction`（role↔stage map 集中驗證）。
- **簽核意見與內容變動會發站內消息**（2026-08-04 業主要求）：任一關「通過**但有填意見**」、
  退回、強制退回、撤回核定、**送出後被修改**（含退回改完重送）→ 寫 `app_messages`，
  收件人是該份日誌的主任 ＋ 前面關卡的經手人（排除操作者本人）；重送再加上全部
  辦公室助理（那份會回到他們的待審核清單）。
  **通過而沒填意見不發、首次送出也不發**（業主原話：「有意見，再有消息就好」；
  首次送出靠導覽列「待審核」紅字就夠了）。
  站內消息不需綁 LINE、不吃官方帳號額度 — 見下方「通知有兩條路」。
- **辦公室助理可全權修改日誌內容**（工項、數量、照片、備註都可以）：
  - `submitted` / `rejected` → 直接編輯（silent post_edit，寫 `daily_log_revisions`）。
    入口有三個：日誌詳情頁右上「編輯」、**審核頁標題右側「直接修改這份」**、
    **待簽列表每張卡片下緣的「直接修改這份」**（後兩個是 2026-08-04 補的 —
    功能一直都在，但助理整天待在 `/approvals`，那裡沒按鈕等於沒有這個功能）
  - `approved` → 不能直接改，先按「撤回核定」（`revokeApprovalAction`）退回 audit 關，
    簽名作廢、PDF 標為過期，改完重走核定。需 migration-2.31 的 RLS policy。
  - 改過的日誌在列表 / 詳情頁 / 待簽核清單掛「經助理修改」標籤，
    編輯軌跡用 `lib/log-diff.ts` 把 snapshot 算成人看得懂的前後對照（原文小字）。
- 卡住的日誌：owner / office_staff 可在逾時後「強制處理」（有 audit trail，含 DELETE trigger）。
- 請假（`/leaves`）另有獨立簽核鏈，依申請人 role 自動往上送。
- **請假代理人**（2026-09-27，migration-2.43 已套正式站；Phil：「主任請假就沒人送日誌」）：
  工地主任請假時可指定一位**現場人員**當代理人（`leave_requests.proxy_id`，選填，送出後本人／助理／老闆可改）。
  - **假單送出就生效**（簽核中或已核准都算，不等核准）；退回 / 取消 → 代理失效。
  - 代理人只能填**請假期間那幾天**（台北日期）的日誌；新建只能在請假第一天 ~ 最後一天 + 3 天（補寫），
    已經建的草稿 / 退件之後照樣能改好重送（只看日期）。
  - 代理日誌的 `supervisor_id` = 代理人本人（他填、他簽、退回也是他改），`proxy_for` = 請假的主任；
    畫面、通知、PDF 顯示「王小明（代理 陳主任）」，PDF 表頭「工地主任」寫請假主任並註明代理填寫。
  - 代理人能做：填 / 暫存 / 簽名送出、併現場回報、新增未簽約臨時項、改退件重送、刪自己的草稿。
    不能做：送出後自己改（DB trigger 也擋）、複製日誌、下載 PDF。請假主任看得到代理日誌（唯讀）並收站內消息。
    併現場回報**不開 RLS**（開了會跟「作者可改自己的回報」組合成漏洞），由 `saveLogAction` 驗完代理身分後用 service role 做。
  - 代理權限從假單來，所以 2.43 同時加了**請假單守門 trigger**（`guard_leave_request_write`）：送出後內容不能改、
    狀態只能照簽核流程走、申請人不能自己核准 — 改請假流程時要一起看這個 trigger。
  - 現場人員平常沒有日誌入口；代理期間打卡／回報頁最上面出現「寫施工日誌」卡，導覽列多「代理日誌」。
  - 規則寫兩處、要一起改：`lib/leave-proxy.ts`（程式）與 DB 的 `is_log_proxy()` / `has_proxy_duty()`（RLS）。
  - 名字一律用 `lib/logs/proxy.ts` 的 `loadProfileNames()`（service role）— **主任 / 現場人員讀不到別人的
    profiles（RLS）**，embed `profiles!…(full_name)` 在他們那邊是空的（請假頁申請人「—」就是這樣來的，同批修掉）。

## 功能地圖（route → 用途）

| Route | 功能 |
|---|---|
| `/cases` `/cases/new` `/cases/[id]` | 案件 CRUD、標單 .xlsx 匯入 preview、工項樹 + 累計進度、合約外/未簽約區塊、出勤時間軸、座標 picker |
| `/logs` `/logs/new` `/logs/[id]` | 施工日誌（工項勾選、percent/absolute 數量、出工＋點工人數、照片+說明、天氣 chips、localStorage 草稿、**「本日無施工」一鍵送單**：旗標在 `manpower.no_work`，零工項照走完整簽核） |
| `/approvals` | role-aware 待辦（同 URL：助理看 audit、核定人看 approve、審閱人看「加簽」清單） |
| `/field-reports` | 現場回報（field_assistant 為主；離線 IndexedDB 佇列） |
| `/attendance` | GPS 上下班打卡（軟性 geofence、離線前景排隊） |
| `/leaves` | 請假申請 + 簽核；工地主任可指定代理人（現場人員）代送施工日誌 |
| `/messages` | 消息中心（簽核意見 / 退回原因 / 撤回核定；header 鈴鐺紅點進來）|
| `/dashboard` | owner / office_staff 紅黃綠健康卡片 |
| `/my-cases` | field_assistant / supervisor 的個人案件視角 |
| `/reports/*` | 出勤、簽核延遲、未簽約、工項、案件總覽等報表 + xlsx 匯出 |
| `/staff` | 帳號管理（office_staff / owner）；有薪資權限的人多一顆「薪制」按鈕（月薪／日薪＋生效日），老闆編輯助理時可勾「可處理薪資」 |
| `/payroll` `/payroll/settings` `/payroll/holidays` | 薪資（2026-09 Phase A，office_staff / owner）：規則設定、假日行事曆、人員薪制總覽。見下方「人事／薪資」節 |
| `/schedule` `/schedule/templates` | 排班（Phase B）：週曆格子（點格子排、快速排班、複製上週）、班別範本。office_staff / owner 編輯，site_supervisor 唯讀；工人在 `/attendance` 看「本週班表」卡 |
| `/reports/work-hours` | 工時對帳（Phase C，office_staff / owner）：打卡配對成工作段 → 正常／分段加班／假日時數、遲到早退缺勤、請假時數、異常清單（連到補登）、Excel。只有時數沒金額 |
| `/account` | 個人設定（改密碼、LINE 通知綁定） |
| `/api/cron/*` | Vercel cron 入口（見下方「排程」節） |
| `/api/line/webhook` | LINE 官方帳號 webhook（綁定碼、解除綁定；詳見 [`docs/LINE.md`](LINE.md)） |

登入方式：**帳號（username）+ 密碼**，不是 email（server 端 username→email 映射）。

## 通知有兩條路（兩條都送，互不影響）

| | LINE 推播 | 站內消息 |
|---|---|---|
| 程式 | `lib/notifications/notify.ts` + `events.ts` 的 `notify*` | `lib/notifications/messages.ts` + `events.ts` 的 `message*` |
| 收得到的人 | **只有綁定 LINE 且分類開關有開的人** | 所有啟用中的收件人，不用綁任何東西 |
| 成本 | 官方帳號免費額度 200 則/月（批簽走彙總省額度）| 0（自己的 DB）|
| 看得到的地方 | LINE 對話 | header 鈴鐺紅點 → `/messages`；日誌詳情頁頂部 banner |
| 送什麼 | 待辦推進、核定、退回等全流程事件 | 只送「有話要說」類：簽核意見、退回原因、撤回核定、日誌被修改 / 重送 |

⚠ **要通知「底下的人」時不能只呼叫 `notify*`。** 2026-08-04 業主回報「我核過的日誌
有在下面給意見，可是底下的人不會跳通知」— 原因就是主任 / 助理都沒綁 LINE
（問過也沒有想綁的意思，助理習慣用電腦），`sendNotification()` 直接把他們濾掉了。
新增「一定要讓對方知道」的事件時，兩條都要接。

## 資料庫

- 表：profiles, cases, case_work_items, daily_logs, log_approvals, tender_imports,
  field_reports, daily_log_revisions, extra_contracts, login_attempts, audit_logs,
  attendance_events, leave_requests, leave_approvals, line_bindings,
  notification_queue, app_messages, app_settings, request_logs, error_logs,
  employee_pay_profiles, holidays, shift_templates, schedule_entries（+ storage buckets:
  daily-photos, signatures, daily-log-pdfs — 全部 private + signed URL）
- **資料庫層的防線（migration-2.38）**：一般使用者只能改自己 profiles 的姓名／電話；
  `current_user_role()` 對停用帳號回 null；`trg_daily_logs_guard` 只准 owner 把日誌變成 approved、
  主任不能改／刪已核定的日誌（2.43 起請假代理人〔現場人員〕同一套規則）。**改簽核流程時要一起看這個 trigger**，不然合法流程會被擋。
  新帳號的 profile 由 trigger 建成「停用的現場人員」，/staff 再用 service role 設角色並啟用。
  健檢結果與還沒擋的項目見 [`docs/SECURITY.md`](SECURITY.md)。
- **RLS 是正式 role-based**（migration-2.10 起），不是 POC 全開版。改 policy 前先讀
  MIGRATIONS.md 2.10 / 2.14 / 2.15 / 2.18 的收緊歷史。
- **profiles 的 RLS 只讓主任 / 現場人員讀自己那一列**（`profiles_self_read`：本人 + office_staff / owner / reviewer）。
  他們開得到的頁面要顯示別人時，embed `profiles!…(full_name)` 會是 null、`from("profiles")` 只撈得到自己：
  名字用 `lib/logs/proxy.ts` 的 `loadProfileNames()`，要列名冊（排班表人員列、出勤報表人員篩選）用
  `lib/staff-directory.ts` 的 `loadStaffDirectory()`。兩個都是 service role、只回最少欄位，**頁面先做完角色檢查再呼叫**；
  embed 留著當備援。**不要放寬 policy** — RLS 整列放行，profiles 還有電話、薪資權限旗標。
  2026-09-27 全站掃過一輪（decisions.md 同日「別人的名字是空的」節）。
- **`daily_logs.manpower` 是 jsonb**：出工（`today_total`）、點工（`day_labor` +
  `day_labor_note`，臨時人力只請款不簽約，**與出工分開累計**）、外包工別、機具都在裡面，
  加欄位不用 migration。
- **attendance_events 是 immutable event log**：故意不開 UPDATE/DELETE，修正只能補新事件。
- **Migration 流程**：新增 `docs/migration-2.X.sql`（必須冪等）→ 登記到 `docs/MIGRATIONS.md`
  → 由 Evelyn 貼到裕民 Supabase SQL editor 手動執行。
- ⚠ **用 Supabase MCP 前，先確認這條 MCP 現在連到哪個專案**。這件事會變：
  2026-08 以前這份文件寫「MCP 連的是 Evelyn 個人帳號、不是 production」，當時成立，
  後來已改指到裕民 production；之後也可能再換。**不要憑這份文件的記憶假設，每次自己查。**
  - 查法：`list_projects` / `get_project_url` 取得 project ref，跟 App 實際用的
    `NEXT_PUBLIC_SUPABASE_URL`（`.env.local`，或 Vercel 環境變數）裡的 ref 比對。
  - **ref 相同 = 正式站**：唯讀查詢可直接跑（production 狀態要查就查，不用猜）；
    **任何寫入（migration、資料修補）動手前先跟 Evelyn 確認**，執行時包在同一個
    transaction、附自我檢查（不符預期就 `raise exception` 整筆 rollback），
    並在改動前把原值留一份（例：寫進 `audit_logs`，retention 1 年）。
  - **ref 不同 = 開發／個人環境**：可以自由試，但**它的結果不能拿來推論 production 狀態**，
    也絕不能把 yumin migration 跑在上面；production 狀態以 MIGRATIONS.md + Evelyn 確認為準。
  - **查不出來就當正式站處理**（保守優先），並在回報時說明無法確認。

## 部署與排程

- **Push `main` → Vercel 自動 deploy**（Hobby plan）。
- ⚠ **Vercel Hobby 限制**：cron 只能每日一次、數量有限。`vercel.json` 違反限制會造成
  **silent deploy failure**（push 後完全不 deploy、無報錯）— 踩過一次（2026-05-17）。
  改 `vercel.json` 後務必確認 deploy 有觸發。
- 現有 cron：`cleanup-orphan-photos`（23:30 台北）、`recheck-stuck-pdfs`（00:00 台北）。
  資料留存清理（audit/log 表 retention，`lib/retention.ts`）與 LINE 通知重試/佇列清理
  （`lib/notifications/notify.ts`）都掛在 `recheck-stuck-pdfs` route 內執行。
- **每日備份**：GitHub Actions `backup.yml`（02:00 台北）→ DB pg_dump + Storage → Cloudflare R2；
  失敗寄 email、每週寄 heartbeat。細節見 [`docs/BACKUP.md`](BACKUP.md)。

## 系統監控（2026-09-26）

四頁：`/reports/logins` 登入紀錄、`/system/usage` 常用操作、`/system/slow` 慢請求、`/system/errors` 錯誤紀錄。
後三頁與上方的「系統監控」入口**只有 `SYSTEM_ADMIN_USERNAMES` 名單上的帳號看得到**（Vercel 環境變數，
逗號分隔的登入帳號；目前是 `admin` = Evelyn）。名單外的人打網址是 404；登入紀錄仍照舊開給助理 / 老闆。
本機開發的名單放 `.env.development.local`。

資料怎麼來（`lib/monitor/`，表在 migration-2.39，保留 90 天）：
- **request_logs**：proxy 在每個已登入的請求貼上 `x-ym-*` header（起始時間、request id、user id；
  client 送來的同名 header 一律清掉）→ `createClient()` 第一次被呼叫時登記、`getActor()` 補上角色 →
  用 `after()` 在**回應送完之後**寫一筆（耗時 = proxy 收到請求到回應送完，不含使用者端網路）。
  server action 的名稱從 Next 的 server-reference manifest 取 `exportedName`。
  開頁面／站內換頁看瀏覽器的 `Sec-Fetch-Mode`（Next 16 的 `headers()` 會刪掉 `RSC` 這類 header，proxy 也看不到）。
  `/api/*`、公開頁不記；prefetch 只跑到 loading 邊界、執行不到 `createClient()`，自然不會被記。
- **error_logs**：伺服器錯誤走 `instrumentation.ts` 的 `onRequestError`；資料庫錯誤走 `wrapDbError`
  （記下 DB 原文，使用者只看到中文）；瀏覽器錯誤由 `app/error.tsx`、`global-error.tsx`、
  `instrumentation-client.ts` 用 sendBeacon 送到 `/api/monitor/client-error`（每人 10 分鐘最多 30 則）。
- 記錄失敗絕不影響正常功能（全部吞錯；表不存在時只 warn 一次）。
- **本機 `next dev` 預設不寫**：本機連的也是正式 DB，開發模式的編譯時間（5～30 秒）會灌爆慢請求頁。
  要在本機測監控功能時，在 `.env.development.local` 加 `MONITOR_IN_DEV=1`，測完拿掉。
- 彙總一律用 `monitor_*` SQL function（PostgREST 單次 1000 筆上限，不能拉原始列回來算）。

⚠ **新增頁面或 server action 時，要在 `lib/monitor/labels.ts` 加中文名稱** —
`lib/__tests__/monitor.test.ts` 會掃 `app/` 底下所有 page 與 `'use server'` 檔，漏了測試會失敗。
- Secrets / production 憑證放 `D:\Evelyn\_secrets\`（本機）+ GitHub Actions secrets，
  **絕不進 repo**（.gitignore 已有 `*secrets*` 防呆）。

## 鐵則

1. **`SUPABASE_SERVICE_ROLE_KEY` 只在 server-side**（`lib/supabase/` 與 server actions），絕不傳到前端
2. **欄位命名 `snake_case`**（DB 端）；TypeScript 端可 camelCase
3. **建表後立即建 RLS**，不留到後面補
4. **時間用 `TIMESTAMPTZ`**；FK 用 UUID（`gen_random_uuid()`）
5. **每個 Server Action 開頭必須驗證**：(1) 前置 status (2) 操作者角色
6. **Migration 檔必須冪等**（可重複跑），寫完登記 MIGRATIONS.md
7. **手機優先**：主任/工人介面觸控目標 ≥ 44px、表單回饋用 sonner toast、爛訊號要能存草稿
8. **UI 文案**：台灣繁體、全形標點、對話感、不用「您」；引導提示一律用 `<NextStepHint>` 元件
9. **會影響效能／DB 查詢量／storage 成本的功能，動工前先警告 Evelyn**
   - **auth 一律走 `tryGetActor()` / `getActor()` / `requireRole()`**（`lib/auth/require-role.ts`，
     已包 React `cache()`，會擋停用帳號）。不要在 page / layout / action 自己寫
     `supabase.auth.getUser()` + 撈 profile — 那是真的打一趟 Supabase Auth server，也沒看 is_active。
     2026-09-26 起 proxy 與 `getActor()` 用 `getClaims()`（ES256 公鑰本機驗章，不打 Auth server）；
     只有 proxy 處理 `/login` 時用 `getUser()`（停用帳號的 JWT 還沒過期時，只看 JWT 會無限導向）。
   - **同一頁的獨立查詢用 `Promise.all`**，不要一個個 await 排隊。
   - **日誌表單的工項／累計只撈「當下這一案」**（`lib/logs/case-form-data.ts`），
     換案時由 client 呼 `loadCaseFormDataAction` 補抓。不要再一次撈全部 active 案件。
10. **不確定的事查證，查不到就明說，不要編造**（包含 production DB 狀態）

## 設計原則（簡述；詳見 `.claude/agents/frontend-designer.md`）

### 配色（裕民品牌）
- 主：深邃海軍藍 `#003153`（headers、按鈕、sidebar）
- 背景：暖米白 `#F5F1EC`（不用 `#f8f9fa` 冷灰）
- 內文：中性棕灰 `#5A5050`（不用純黑）
- Accent：溫銅金 `#A07850`（每頁最多一處）

### 反 SaaS 模板規則
- ❌ `rounded-xl` 到處用 → ✅ `rounded-md` 為主
- ❌ `shadow-lg` 浮動效果 → ✅ 邊框 `#E0DCD6`
- ❌ AI 預設藍色按鈕 → ✅ 深海軍藍主按鈕

## 驗證方式

- `npm run lint`、`npm run test`（vitest，parser 等單元測試在 `lib/__tests__/`）、`npm run build`
- UI 改動後：以對應角色視角實際走一遍流程（可用 sim subagents 審查）
- 完成一批功能後跑 `qa-reviewer` / `uiux-reviewer` / `guidance-reviewer` subagent

## Subagent 使用（`.claude/agents/`，13 個）

- `backend-engineer` — Server Actions、Supabase queries、RLS
- `frontend-designer` — UI 元件、shadcn 覆寫、品牌風格
- `db-architect` — Schema、migrations、RLS policy
- `line-integrator` — LINE OA / LIFF（Phase 5，尚未開始）
- `qa-reviewer` — 完成 Phase 後品質審查
- `uiux-reviewer` — UI/UX 審查（觸控、表單、回饋）
- `guidance-reviewer` — NextStepHint 引導覆蓋率審查
- `layout-consistency` — 版面一致性審查
- `owner-sim` / `site-supervisor-sim` / `office-staff-sim` — 第一人稱使用者驗證
- `brand-page-designer`、`proposal-editor` — 提案/品牌頁面（多用於 parent 資料夾）

## 重要文件

- [`docs/decisions.md`](decisions.md) — 各 Phase 決策記錄（why）。**改架構前必讀**
- [`docs/MIGRATIONS.md`](MIGRATIONS.md) — migration 執行順序 + 排錯
- [`docs/LINE.md`](LINE.md) — LINE 通知架構、後台設定、額度成本、疑難排解
- [`docs/SECURITY.md`](SECURITY.md) — 資安 / 效能健檢紀錄（修了什麼、還要 Evelyn 處理什麼、第二批建議）
- [`docs/BACKUP.md`](BACKUP.md) — 備份機制
- [`docs/SETUP.md`](SETUP.md) — 初始建置紀錄（歷史文件，內容為 POC 時期）
- `docs/schema.sql` — 初始 schema（之後的變更都在 migration-2.X.sql）
- `標單範例/` — Phil 給的真實標單供 parser 測試
- 提案與品牌素材在 parent 資料夾 `D:/Evelyn/yumin/`（見該處 CLAUDE.md）

## 與 Phil 對接的承諾

- 程式碼歸 Still Lab，裕民永久完整使用授權
- 所有雲端帳號（Supabase / Vercel / GitHub）以裕民名義
- Repo：https://github.com/yumindb/admin（裕民擁有）
- 試跑期 bug 視為保固，不另計費

## 人事／薪資（2026-09 起，分階段）

業主要的：排班表登記、正職月薪／日薪人員的薪資計算（加班倍率、季獎金、遲到扣款），
而且**後台要能彈性設定，之後可能給餐飲分公司用**。全部用「只加新表、不動舊表」安插，
打卡（`attendance_events`）、請假、簽核流程一行都沒改。分期：

| 階段 | 內容 | 狀態 |
|---|---|---|
| A | 薪制檔案、假日行事曆、規則設定、權限（migration-2.40） | ✅ 2026-09-26 程式完成 |
| B | 排班：`shift_templates` + `schedule_entries`（migration-2.41）、`/schedule` 週曆、打卡頁「本週班表」卡 | ✅ 2026-09-26 程式完成 |
| C | 工時配對引擎（`lib/payroll/work-hours.ts`）＋ `/reports/work-hours` 對帳報表＋ Excel；無 migration | ✅ 2026-09-27 程式完成 |
| D | 月結：`payroll_runs` + `payroll_items` 快照、季獎金、xlsx、員工看自己的薪資單 `/my-pay` | 未做 |
| E | 遲到扣款實際啟用、餐飲多班別 | 未做 |

**權限分兩層**（`lib/payroll/access.ts`）：
- 規則設定、假日行事曆 → `office_staff` / `owner`（`requireRole`）
- 薪資金額、月結、薪資單 → `owner`，或老闆在 `/staff` 勾了「可處理薪資」的助理
  （`profiles.can_manage_payroll`；DB 端 `has_payroll_access()`）。
  旗標**故意不放進 `loadActor`** — migration 沒跑時欄位不存在，放進去全站登入都壞；
  `hasPayrollAccess()` 另外查一次，查不到一律當沒權限。

**資料**：
- `employee_pay_profiles` **append-only**：調薪 = 新增一列新的 `effective_from`，舊列保留；
  某日生效的薪制 = `payProfileOn(rows, date)`（`lib/payroll/pay-profiles.ts`）。金額不放 `profiles`
  （profiles 全員可讀）。寫入只走 service-role。
- `holidays`：只放「實際放假的平日」（假日落在週六日就放補假日）；`is_workday = true` 是補班日。
  週六／週日是休息日／例假日由設定決定（餐飲店休可改）。`dayTypeFor()` 在 `lib/payroll/holidays.ts`。
- 規則在 `app_settings` 的 `payroll.*` 六組（`lib/payroll/settings.ts`，zod 每欄都有預設）：
  work_rules（8 小時／5 天／月薪÷30÷8／自動扣休息／加班以分計／每月 46 小時只警告）、
  overtime（平日 2h×1.34 + 2h×1.67；休息日 2h×1.34 + 6h×1.67 + 4h×2.67；例假日與國定假日 ×2）、
  late（**預設關**，寬限 10 分，按分鐘或固定額）、leave_pay_ratios（事假 0、病假 0.5、特休／公假／婚喪 1）、
  bonus（每季出勤 ≥ 60 天 → 天數 × 200；特休／公假視同出勤；季末後第 2 個月隨薪資發；可依季覆寫門檻）、
  payday（每月 5 號）。**讀不到一律回預設**，不會因為設定壞掉變成另一套規則。
- 勞基法的倍率其實是 1⅓／1⅔，預設放 1.34／1.67（業主原話 1.33／1.66 是口語，四捨五入方向要對）。

**排班**（`lib/payroll/schedule.ts`）：
- `shift_templates` 班別範本：名稱、短名（格子上顯示）、起訖、休息分鐘；`end_time <= start_time` = 跨日班；
  **不刪只停用**（舊班表還指著它）。裕民種一筆「日班 08:00–17:00 休 60」；餐飲分公司自己加早／午／晚。
- `schedule_entries`：某人某天排哪個班，一天可多筆（兩頭班），範本或自訂時間二擇一，可綁案件、備註。
  `setDayScheduleAction` 是**整天覆寫**（先刪再寫）；`fillWeekScheduleAction` 只填還沒排的日子；
  `copyWeekScheduleAction` 把上週有排班的人整週覆寫到本週。
- 週一起算（`weekStartOf`）。格子表頭帶假日名稱、週末／假日灰底。
- 排班是遲到判定與季滿勤的基準線；排了班的日子一律算平日（Phase C 的 `dayTypeFor` 要多吃這個參數）。
- **排休**（`day_off_requests`，migration-2.42）：員工在班表排出來**之前**標「這天不能上」，跟請假是兩回事
  （排休 = 給排班者的提醒、不簽核、不影響薪資；請假 = 班表已排、事後不能來、走簽核鏈）。
  員工在 `/attendance` 的「排休」迷你月曆點日期標／取消；只能標未來、還沒排班的日子（已排班要休走請假）；
  每月上限、截止日、至少提前幾天在 `payroll.day_off` 設定（預設都不限）。排班格子上顯示「休」，
  硬要排會再問一次；快速排班自動跳過排休日。2026-09-26 Evelyn 拍板：不用核准、裕民也開。

**工時對帳引擎**（`lib/payroll/work-hours.ts`，純函式、17 個測試；資料層 `work-hours-data.ts`）：
- 配對：`attendance_events` 依時間序 clock_in → clock_out；連兩個上班卡＝前一段「沒下班卡」、沒開著的下班卡＝「沒上班卡」、
  相隔 > 18 小時＝兩邊都漏卡。**配不起來不猜**，列異常連到既有補登。工作段歸屬「上班那天」（台灣日界），跨午夜晚班不會被切。
- 每天：扣休息（有排班照班別休息分鐘總和；沒排班用「單段超過 N 小時扣 M 分」）；日型別＝有排班一律平日，
  否則 `dayTypeFor`；平日超過每日正常工時的部分依 `weekday_tiers` 分段（超出分段沿用最後倍率）、休息日全部進
  `rest_day_tiers`、例假日／國定假日整天 × `holiday_multiplier`；加班分鐘先依 `ot_unit_minutes` 無條件捨去。
- 遲到＝第一筆上班卡晚於排定上班＋寬限（超過就從排定時間起算全部分鐘）；早退＝最後下班早於排定下班；
  缺勤＝有排班、沒打卡、沒有核准的假。請假時數＝核准假單與該日的重疊小時，上限每日正常工時。
- 月彙總：排班天／出勤天／各倍率時數／加班合計對照每月上限（只標記）／遲到次數與分鐘／缺勤／各假別時數／異常。
- **只算時數 × 倍率，不算錢**；月結（Phase D）才乘時薪。

**桌機導覽列**（2026-09-26 改版，`components/desktop-nav.tsx`）：項目到 11–12 個後一排放不下。
每個連結分三種：primary 永遠直接放；`group`（人事 ▾ = 人員管理／排班／薪資）一律下拉；
`secondary`（我簽過的、現場回報、報表、系統監控）在 2xl（≥1536px）直接放，其餘寬度收進「更多 ▾」。
Logo 文字 md 只放徽章、lg 起「裕民工務」、xl 起全名；姓名／公司區塊 xl 才顯示，之前用小頭像。
純 CSS 斷點，不量寬度。實測 768／1024／1280／1536 都不重疊。

**明確不做**（先講清楚）：勞健保、勞退、所得稅扣繳不在範圍；月結會留手動加減項。

## 已知待辦（大方向）

- 人事／薪資 Phase B–E（見上節）；動工前要 Phil 確認的都已在 2026-09-26 拍板（見 decisions.md）

- LINE 整合（Phase 5）：**通知推播已上線（2026-07，見 docs/LINE.md）**；LIFF 打卡未做
- LINE 訊息額度觀察：免費方案 200 則/月，試用期後視用量決定是否升級中用量（NT$800/月）
- 離線送出「日誌」（打卡與現場回報已有前景排隊；日誌還沒有）
- work_item_library 跨案工項詞典（Phase 3 構想）
- 登入頁仍顯示「POC 試用」字樣，正式命名後要改

（註：批簽、複製日誌、工項搜尋等舊 TODO 已完成 — decisions.md 各 Phase 的
「已知限制」是當時的快照，不要當成現在的待辦清單。）
