# Yu Min Admin — 專案指令

裕民工務內部工程管理系統。Claude Code 進入此資料夾請先讀此檔再開始工作。

## 專案概覽

- **客戶**：裕民工務（三家公司共用，員工跨公司）
- **顧問/開發者**：Evelyn @ Still Lab（兼職 + AI 協作）
- **POC 階段目標**：1-2 週內做出可給 Phil 看的 demo
- **後續**：依試跑回饋演化為 Phase 1-2 正式版（NT$18-22 萬）

## POC 三個 Demo 場景（先做這三個，其他不做）

1. **案件開案 + 標單匯入** — 上傳 .xlsx → 階層 preview → 寫入案件
2. **施工日誌填寫**（手機畫面）— 從匯入工項勾選 + 填數量 + 拍照 + 送出
3. **老闆簽核**（Web）— 待辦列表 → 摘要 + 簽名 → 跳下一份

POC 不做：LINE 整合、PDF 匯出、打卡、請假、複雜 RLS、四關完整流程（先做 1 關）

## 技術棧

- **Next.js 15** App Router（React 19）+ TypeScript + Turbopack
- **Tailwind CSS v4** + **shadcn/ui**（Radix + Lucide + Geist）
- **Supabase**（PostgreSQL + Auth + Storage）
- **xlsx**（標單 parser）
- **react-signature-canvas**（簽名）
- **react-hook-form + zod**（表單驗證）

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

## 角色 (4 + 1 待裁示)

- 工地主任（手機 — 工地現場、髒手套、強光、爛訊號）
- 辦公室助理（桌機 — 開案、項目庫、第三關審核）
- 老闆 Phil（手機 — LINE 為主入口；最終核定）
- 系統管理員（桌機 — 帳號、角色設定）
- 監工（待 Phil 拍板：刪除 / 保留為複核可指派 / 保留但不簽核）

## 簽核流程

**現行三關：** 工作日誌填表（工地主任／老闆）→ 審核（辦公室助理）→ 核定（老闆）

**前置：** 現場回報（現場人員／工地主任／老闆，非簽核關卡）— 由工地主任在填工作日誌時可選擇合併。

註：原 4 關設計含「複核（工地主任）」階段，2026-05 業主回饋拿掉（commit b787d20）。

## Subagent 使用

複雜任務請呼叫 `.claude/agents/` 內的 subagent：
- `backend-engineer.md` — Server Actions、Supabase queries、RLS
- `frontend-designer.md` — UI 元件、shadcn 覆寫、品牌風格
- `db-architect.md` — Schema、migrations、RLS policy
- `line-integrator.md` — LINE OA / LIFF（Phase 5）
- `qa-reviewer.md` — 完成 Phase 後品質審查
- `uiux-reviewer.md` — UI/UX 審查（觸控、表單、回饋）
- `owner-sim.md` / `site-supervisor-sim.md` / `office-staff-sim.md` — 第一人稱使用者驗證

## 重要文件

- `docs/schema.sql` — Supabase schema（待建）
- `docs/architecture.md` — 系統架構文件（待建）
- `標單範例/` — 2 個 Phil 給的真實標單供測試
- `_work/` — 提案階段的草稿、分析（在 parent 資料夾 `D:/Evelyn/yumin/_work/`）
- 提案 PPTX：`D:/Evelyn/yumin/Yu Min Admin Proposal.pptx`

## 鐵則

1. **`SUPABASE_SERVICE_ROLE_KEY` 只在 `lib/supabase/server.ts`**，絕不傳到前端
2. **欄位命名 `snake_case`**（DB 端）；TypeScript 端可 camelCase
3. **建表後立即建 RLS**，不留到後面補
4. **時間用 `TIMESTAMPTZ`**（不用 TIMESTAMP）
5. **FK 用 UUID**（`gen_random_uuid()`）
6. **POC 階段：可用簡化 RLS，但留下 TODO 註記要在正式版補強**
7. **每個 Server Action 開頭必須驗證**：(1) 前置 status (2) 操作者角色

## Phase 1-2 Schema 必須在第 1 週敲定的事項

詳見 `.claude/agents/db-architect.md`，三個關鍵決策：

1. `profiles.company` 單欄位 vs 多對多 — **建議單欄位**（員工跨公司由 admin 開案時指派）
2. `approval_stages` 固定 4 列 vs 動態 — **建議動態**（保留 #22 監工彈性）
3. `case_work_items` 階層 — **建議一張表 + parent_id + sort_path + item_type enum**

## 與 Phil 對接的承諾

- 程式碼歸 Still Lab，裕民永久完整使用授權
- 所有雲端帳號（Supabase / Vercel / GitHub）以裕民名義
- Repo 在 `https://github.com/yumindb/admin`（裕民擁有）
- 試跑期 bug 視為保固，不另計費
