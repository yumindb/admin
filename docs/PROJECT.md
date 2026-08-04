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

## 角色（4 種，enum `user_role`）

| role | 主要裝置 | 首頁 | 做什麼 |
|---|---|---|---|
| `field_assistant` 現場人員 | 手機 | /field-reports | 現場回報、打卡、請假 |
| `site_supervisor` 工地主任 | 手機 | /logs | 施工日誌、複核、打卡、現場回報、請假 |
| `office_staff` 辦公室助理 | 桌機 | /（案件列表） | 開案、標單匯入、審核、報表、帳號管理、追加合約 |
| `owner` 老闆 Phil | 手機+桌機 | /approvals | 核定簽名、dashboard、報表、帳號管理 |

- 「系統管理員」角色**沒有做**：帳號管理放在 `/staff`，office_staff / owner 皆可操作。
- 「監工」角色（提案 #14/#22）**沒有做**，若業主重提再議。
- **主任跨案件是設計不是漏洞**：裕民 2026-05 拍板主任可看所有案件、對任何案件建日誌
  （daily_logs / cases read-all）。但 signatures bucket 仍隔離（只能讀自己 folder）。

## 簽核流程（四關，全都要手寫簽名）

```
draft →[主任填表+簽名 fill]→ submitted+review
     →[主任複核 review]→ submitted+audit
     →[辦公室審核 audit]→ submitted+approve
     →[老闆核定+簽名 approve ×2]→ approved（自動產 PDF）
     →[任一關退回]→ rejected →[修正重送]→ 回到 audit
```

- **退回後的重送有兩條路**（2026-08 修，業主回報「改完只能存檔、送不出去」）：
  - **主任本人**：`/logs/[id]/edit` 是 classic 模式 → 改完按「送出核定」，要**重新手寫簽名**
    （會再寫一筆 `fill` 的 log_approvals）。同頁的「暫存修改」不會把日誌打回 `draft`，
    狀態維持 `rejected`（以前會降級成 draft，整份從所有人清單消失且不發通知）。
  - **辦公室助理 / 核定人**：post-submission 模式 → 「存檔並重新送出」直接把日誌送回
    `submitted` + `audit`，不需要重簽（與「助理可改簽核中日誌」一致）。同時更新
    `submitted_at`、`approve_signatures` 歸零（雙簽的「本輪」靠 submitted_at 判定），
    並發 `log_resubmitted` LINE 通知。內容沒動也照送 — 按鈕語意就是重送。

- **核定關是雙簽**（2026-07-20 業主拍板）：要**兩位不同的 owner** 都簽名才 `approved`，
  不限順序。第一簽完成後日誌仍停在 `approve`，並通知另一位補簽。
  ⚠ **UI 文案一律寫「核定人」不寫「老闆」**（2026-08 業主要求，畫面上不點名老闆）。
  計數在 `daily_logs.approve_signatures`（migration-2.29，compare-and-set 防同時簽），
  「本輪」以 `log_approvals.created_at >= daily_logs.submitted_at` 判斷（退回重送重新計）。
  系統只有一個 owner 帳號時自動退回單簽（見 `lib/approvals/dual-sign.ts`）。

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

## 功能地圖（route → 用途）

| Route | 功能 |
|---|---|
| `/cases` `/cases/new` `/cases/[id]` | 案件 CRUD、標單 .xlsx 匯入 preview、工項樹 + 累計進度、合約外/未簽約區塊、出勤時間軸、座標 picker |
| `/logs` `/logs/new` `/logs/[id]` | 施工日誌（工項勾選、percent/absolute 數量、出工＋點工人數、照片+說明、天氣 chips、localStorage 草稿） |
| `/approvals` | role-aware 待辦（同 URL 三種角色看到自己那關） |
| `/field-reports` | 現場回報（field_assistant 為主；離線 IndexedDB 佇列） |
| `/attendance` | GPS 上下班打卡（軟性 geofence、離線前景排隊） |
| `/leaves` | 請假申請 + 簽核 |
| `/messages` | 消息中心（簽核意見 / 退回原因 / 撤回核定；header 鈴鐺紅點進來）|
| `/dashboard` | owner / office_staff 紅黃綠健康卡片 |
| `/my-cases` | field_assistant / supervisor 的個人案件視角 |
| `/reports/*` | 出勤、簽核延遲、未簽約、工項、案件總覽等報表 + xlsx 匯出 |
| `/staff` | 帳號管理（office_staff / owner） |
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
  notification_queue, app_messages（+ storage buckets:
  daily-photos, signatures, daily-log-pdfs — 全部 private + signed URL）
- **RLS 是正式 role-based**（migration-2.10 起），不是 POC 全開版。改 policy 前先讀
  MIGRATIONS.md 2.10 / 2.14 / 2.15 / 2.18 的收緊歷史。
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
   - **auth 一律走 `tryGetActor()` / `getActor()`**（`lib/auth/require-role.ts`，已包 React
     `cache()`）。不要在 page / layout 自己寫 `supabase.auth.getUser()` + 撈 profile —
     那是真的打一趟 Supabase Auth server，一次導覽重複三四遍就是使用者說的「很慢」。
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

## 已知待辦（大方向）

- LINE 整合（Phase 5）：**通知推播已上線（2026-07，見 docs/LINE.md）**；LIFF 打卡未做
- LINE 訊息額度觀察：免費方案 200 則/月，試用期後視用量決定是否升級中用量（NT$800/月）
- 離線送出「日誌」（打卡與現場回報已有前景排隊；日誌還沒有）
- work_item_library 跨案工項詞典（Phase 3 構想）
- 登入頁仍顯示「POC 試用」字樣，正式命名後要改

（註：批簽、複製日誌、工項搜尋等舊 TODO 已完成 — decisions.md 各 Phase 的
「已知限制」是當時的快照，不要當成現在的待辦清單。）
