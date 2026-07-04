# 裕民工務 管理系統

> 工程日誌 × 四關簽核 × 標單匯入 × GPS 打卡 × 請假 × 營運報表

Phase 1-2 已上線試用中：https://yumin-admin.vercel.app

## 開發

```bash
npm run dev      # http://localhost:3000
npm run lint
npm run test     # vitest
npm run build
```

## 技術棧

- Next.js 16 + React 19 + TypeScript + Turbopack
- Tailwind CSS v4 + shadcn/ui (Radix + Lucide)
- Supabase (PostgreSQL 17 + Auth + Storage)
- xlsx (標單 parser)、react-signature-canvas (簽名)、react-hook-form + zod (表單)
- leaflet + OpenStreetMap (案件座標)、@react-pdf/renderer (日誌 PDF)

## 環境設定

複製 `.env.local.example` → `.env.local`，填入 Supabase keys。

## 重要文件

- `CLAUDE.md` → `AGENTS.md` + `docs/PROJECT.md` — Claude Code 進入專案請先讀
- `docs/decisions.md` — 各 Phase 設計決策（why）
- `docs/MIGRATIONS.md` — DB migration 執行順序與排錯
- `docs/BACKUP.md` — 每日備份（GitHub Actions → Cloudflare R2）
- `.claude/agents/` — 13 個 subagents（後端、前端、DB、審查 + 使用者模擬）
- `標單範例/` — Phil 提供的真實標單樣本（用於 parser 開發）

## 部署

Push 到 `main` → Vercel 自動 build（Hobby plan；改 `vercel.json` cron 前先讀 docs/PROJECT.md 的限制說明）。

## 智財與授權

程式碼著作權歸 Still Lab（一亭工作室）；裕民工務獲得永久完整使用授權。
所有雲端帳號（Supabase / Vercel / GitHub）以裕民名義註冊與持有。
依《著作權法》第 12 條，受聘開發軟體著作權預設歸開發者，出資人擁有使用權。
