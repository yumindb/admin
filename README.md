# 裕民工務 內部工程管理系統

> 工程日誌 × 簽核流程 × 標單匯入 × LINE 通知

POC + Phase 1-2 開發中。給 Phil 看的最初版 demo。

## 開發

```bash
npm run dev
# http://localhost:3000
```

## 技術棧

- Next.js 15 + React 19 + TypeScript + Turbopack
- Tailwind CSS v4 + shadcn/ui (Radix + Lucide)
- Supabase (PostgreSQL + Auth + Storage)
- xlsx (標單 parser)、react-signature-canvas (簽名)、react-hook-form + zod (表單)

## 環境設定

複製 `.env.local.example` → `.env.local`，填入 Supabase 與 LINE 的 keys。

## 重要文件

- `CLAUDE.md` → `docs/PROJECT.md` — Claude Code 進入專案請先讀
- `.claude/agents/` — 11 個 subagents（後端、前端、DB、LINE、QA、UI/UX 審查 + 3 個使用者模擬）
- `標單範例/` — Phil 提供的真實標單樣本（用於 parser 開發）

## 部署

Push 到 `main` → Vercel 自動 build。

## 智財與授權

程式碼著作權歸 Still Lab（一亭工作室）；裕民工務獲得永久完整使用授權。
所有雲端帳號（Supabase / Vercel / GitHub）以裕民名義註冊與持有。
依《著作權法》第 12 條，受聘開發軟體著作權預設歸開發者，出資人擁有使用權。
