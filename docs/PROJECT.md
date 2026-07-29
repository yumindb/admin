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
     →[任一關退回]→ rejected →[主任編輯重送]→ 回到 review
```

- **核定關是雙簽**（2026-07-20 業主拍板）：要**兩位不同的 owner** 都簽名才 `approved`，
  不限順序。第一簽完成後日誌仍停在 `approve`，並通知另一位老闆補簽。
  計數在 `daily_logs.approve_signatures`（migration-2.29，compare-and-set 防同時簽），
  「本輪」以 `log_approvals.created_at >= daily_logs.submitted_at` 判斷（退回重送重新計）。
  系統只有一個 owner 帳號時自動退回單簽（見 `lib/approvals/dual-sign.ts`）。

- 統一走 `approveStageAction` / `rejectStageAction`（role↔stage map 集中驗證）。
- 卡住的日誌：owner / office_staff 可在逾時後「強制處理」（有 audit trail，含 DELETE trigger）。
- 請假（`/leaves`）另有獨立簽核鏈，依申請人 role 自動往上送。

## 功能地圖（route → 用途）

| Route | 功能 |
|---|---|
| `/cases` `/cases/new` `/cases/[id]` | 案件 CRUD、標單 .xlsx 匯入 preview、工項樹 + 累計進度、合約外/未簽約區塊、出勤時間軸、座標 picker |
| `/logs` `/logs/new` `/logs/[id]` | 施工日誌（工項勾選、percent/absolute 數量、照片+說明、天氣 chips、localStorage 草稿） |
| `/approvals` | role-aware 待辦（同 URL 三種角色看到自己那關） |
| `/field-reports` | 現場回報（field_assistant 為主；離線 IndexedDB 佇列） |
| `/attendance` | GPS 上下班打卡（軟性 geofence、離線前景排隊） |
| `/leaves` | 請假申請 + 簽核 |
| `/dashboard` | owner / office_staff 紅黃綠健康卡片 |
| `/my-cases` | field_assistant / supervisor 的個人案件視角 |
| `/reports/*` | 出勤、簽核延遲、未簽約、工項、案件總覽等報表 + xlsx 匯出 |
| `/staff` | 帳號管理（office_staff / owner） |
| `/account` | 個人設定（改密碼、LINE 通知綁定） |
| `/api/cron/*` | Vercel cron 入口（見下方「排程」節） |
| `/api/line/webhook` | LINE 官方帳號 webhook（綁定碼、解除綁定；詳見 [`docs/LINE.md`](LINE.md)） |

登入方式：**帳號（username）+ 密碼**，不是 email（server 端 username→email 映射）。

## 資料庫

- 表：profiles, cases, case_work_items, daily_logs, log_approvals, tender_imports,
  field_reports, daily_log_revisions, extra_contracts, login_attempts, audit_logs,
  attendance_events, leave_requests, leave_approvals, line_bindings,
  notification_queue（+ storage buckets:
  daily-photos, signatures, daily-log-pdfs — 全部 private + signed URL）
- **RLS 是正式 role-based**（migration-2.10 起），不是 POC 全開版。改 policy 前先讀
  MIGRATIONS.md 2.10 / 2.14 / 2.15 / 2.18 的收緊歷史。
- **attendance_events 是 immutable event log**：故意不開 UPDATE/DELETE，修正只能補新事件。
- **Migration 流程**：新增 `docs/migration-2.X.sql`（必須冪等）→ 登記到 `docs/MIGRATIONS.md`
  → 由 Evelyn 貼到裕民 Supabase SQL editor 手動執行。**Claude 這邊的 Supabase MCP 連的是
  Evelyn 個人帳號，不是裕民 production — 絕不能對 MCP 的專案跑 yumin migration。**
  production DB 狀態無法從本機直接查，以 MIGRATIONS.md 記錄 + Evelyn 確認為準。

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
