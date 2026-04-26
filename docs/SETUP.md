# 第一次 Setup 指引（給 Evelyn）

## ✓ 已完成（Claude 幫你做的）

- [x] Node.js 24 安裝
- [x] Next.js 15 + Tailwind CSS v4 + Turbopack 專案建立
- [x] shadcn/ui 設定 + Button 元件
- [x] Supabase JS + SSR + zod + react-hook-form 安裝
- [x] xlsx + react-signature-canvas 安裝（標單 parser + 簽名）
- [x] 11 個 subagents 從 proposal folder 複製過來
- [x] 2 個範例標單（EMT管 / 泵浦）放在 `標單範例/`
- [x] CLAUDE.md + docs/PROJECT.md（Claude Code 進入專案會自動讀）
- [x] .env.local.example 模板
- [x] 第一次 commit + push 到 https://github.com/yumindb/admin

## ⏳ 你接下來要做的（瀏覽器操作，Claude 幫不了）

### Step 1: 啟動 Supabase（10 分鐘）

1. 去 https://supabase.com → 用 GitHub 登入（建議用裕民或 Evelyn 帳號）
2. New Project：
   - Name: `yumin-admin`
   - Region: `Southeast Asia (Singapore)` ap-southeast-1
   - Database Password: 自己存好，等下會用
3. 等 Supabase 啟動（2-3 分鐘）
4. 進入 Project → Settings → API → 複製：
   - **Project URL**（`https://xxxxxxxxxxxx.supabase.co`）
   - **anon public** key（前端用）
   - **service_role** key（server 用，**絕對不能外流**）
5. 在專案資料夾建 `.env.local`（複製 `.env.local.example`），填入這 3 個值

### Step 2: 啟動 Vercel（5 分鐘）

1. 去 https://vercel.com → 用 GitHub 登入
2. **Add New Project** → Import `yumindb/admin` repo
3. Framework: Next.js（自動偵測）
4. Environment Variables：把 `.env.local` 內容複製過去（3 個 Supabase 變數）
5. Deploy
6. 拿到 URL（類似 `https://admin-yumindb.vercel.app`）

### Step 3: 設定網域（之後做，可跳過）

合約承諾的 `admin.yumin.com.tw` 等買網域 + 設好 DNS 再做。

---

## 啟動本地開發

```bash
# 在專案資料夾
npm run dev
# 開 http://localhost:3000
```

⚠ **注意：每次新 terminal 都要先把 Node 加進 PATH**：
```bash
export PATH="/c/Program Files/nodejs:$PATH"
```
或永久加進 Windows 系統 PATH（重開機就好）。

---

## 開始用 Claude Code 寫 POC

```bash
cd D:\Evelyn\yumin\yumin-admin
claude
```

進入後 Claude 會自動讀 `CLAUDE.md` → `AGENTS.md` + `docs/PROJECT.md`，知道專案脈絡。

### 建議的第一個任務（給 Claude Code 的指令）

```
請依 docs/PROJECT.md 的 POC 三個 demo 場景，先做最基礎的：

1. 建 Supabase schema（profiles, cases, case_work_items, daily_logs, log_approvals 五張表）
2. 用 db-architect subagent 設計 schema + RLS policy
3. 寫到 docs/schema.sql 並提供我貼到 Supabase SQL editor 的指令

之後我會跑 schema，再來做 demo 1（標單匯入）。
```

### POC 開發路線（建議順序）

1. **Schema + Auth**（半天）：建 5 張表 + 簡單登入
2. **Demo 1: 標單匯入**（2-3 天）：upload .xlsx → parser → preview → 寫入 case_work_items
3. **Demo 2: 工地主任填日誌**（2-3 天）：手機畫面 + 工項勾選 + 拍照
4. **Demo 3: 老闆簽核**（1-2 天）：列表 + 摘要 + 簽名
5. **打磨 + deploy**（1-2 天）：UI 調整、bug 修正、Vercel 上線

合計 1-2 週兼職可完成。

---

## 給 Phil 看 Demo 的劇本

完成後，建議的 30 分鐘 demo 流程：

1. **開 Vercel URL** → 給 Phil 一個帳號（admin 預先建好）
2. **Demo 1（Phil 在旁邊看）**：你以辦公室助理身份，上傳泵浦標單 .xlsx → preview → 確認匯入
3. **Demo 2（給 Phil 自己摸）**：請 Phil 拿手機掃 QR code 開頁面 → 切換成工地主任視角 → 填一份日誌
4. **Demo 3（Phil 自己簽）**：切換成老闆視角 → 看到剛剛填的日誌 → 簽名 → 確認

Phil 看完會說「就是這樣」或「這裡要改」— 比看 47 頁簡報快 10 倍。

---

## 後續開發節奏

POC OK 後 → 演化成 Phase 1-2 正式版：
- 補完 RLS（POC 用簡化版）
- 加四關完整流程
- 加重大退回機制
- 補項目庫 admin 介面（Phase 3）
- LINE 整合（Phase 5，4 週另議）

不需要重做專案，同 repo / 同 Supabase / 同 Vercel 直接演化。
