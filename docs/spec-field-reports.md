# 現場回報（field_reports）功能規格

> 本文是另一個 session 的接手文件。先讀 `AGENTS.md` 跟 `docs/PROJECT.md` 拿到品牌色、反 SaaS 模板規則、鐵則。再讀 `docs/schema.sql` 跟 `migration-2.1~2.6.sql` 熟悉 schema 風格。

## 背景脈絡

裕民老闆（Phil）回饋：原本四關簽核流程的第一關「填施工日誌」太重，現場人員填不動。改為**現場人員只做簡單回報**（文字＋多張照片＋逐張附註），**工地主任填日誌時把這些回報整合進去**。這些通常是合約外或非合約項目。

```
原本：[現場人員填日誌] → [主任複核] → [助理審核] → [老闆核定]
新版：[現場人員簡單回報]
       ↓ （主任在填日誌時手動勾選整合）
      [主任填日誌＋整合回報] → [助理審核] → [老闆核定]
```

亦即原本的 4 關（fill/review/audit/approve）變 3 關，但 schema 上 `approval_stage` enum 不變動，整個簽核流程動的是「誰」進入第一關，由 `field_assistant` 變 `site_supervisor`。

## 已敲定的決策（不要再問使用者）

- **要登入**：所有現場回報都要登入（field_assistant 角色）
- **案場下拉先列全部 active**：未來再加「案場↔人員指派」表，目前不做
- **合併時文字＋照片都帶過去**：每張照片的「第一個人附註」也要進日誌
- **照片不複製**：合併只把同樣的 storage path push 進 `daily_logs.photos`，回報原 row 留著當審計
- **每次送出 = 一筆 row**：同一人多次送、不同人各送都是獨立 row

## 技術棧（既有，照做即可）

- Next.js 15 App Router、TypeScript、Tailwind v4 + shadcn/ui
- Supabase（PostgreSQL + Auth + Storage）
- 角色 enum：`office_staff` / `site_supervisor` / `owner` / `field_assistant`
- 既有 storage bucket：`daily-photos` — 沿用，不開新 bucket

## Schema 變更

新檔 `docs/migration-2.7.sql`（冪等寫法、含 RLS、跟前面 migration 風格一致）：

```sql
-- enum
do $$ begin
  create type field_report_status as enum ('pending', 'merged', 'archived');
exception when duplicate_object then null; end $$;

-- table
create table if not exists public.field_reports (
  id                  uuid primary key default gen_random_uuid(),
  case_id             uuid not null references public.cases(id) on delete cascade,
  author_id           uuid references public.profiles(id) on delete set null,
  note                text,
  photos              jsonb not null default '[]'::jsonb,
                      -- [{ path: text, caption: text }]
  status              field_report_status not null default 'pending',
  merged_into_log_id  uuid references public.daily_logs(id) on delete set null,
  merged_by           uuid references public.profiles(id) on delete set null,
  merged_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists field_reports_case_idx on public.field_reports(case_id);
create index if not exists field_reports_status_idx on public.field_reports(status);
create index if not exists field_reports_author_idx on public.field_reports(author_id);
create index if not exists field_reports_created_idx on public.field_reports(created_at desc);

-- updated_at trigger
do $$ begin
  create trigger trg_field_reports_updated_at before update on public.field_reports
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

-- RLS（POC 簡化：authenticated 全開；正式版 TODO 寫在註解）
alter table public.field_reports enable row level security;
do $$ begin
  drop policy if exists poc_authenticated_all on public.field_reports;
  create policy poc_authenticated_all on public.field_reports
    for all to authenticated using (true) with check (true);
end $$;
```

別忘記 `docs/MIGRATIONS.md` 加一列。

## 程式變更

### 新增

- `app/(app)/field-reports/page.tsx` — 清單頁
  - field_assistant 只列自己的（`author_id = auth.uid()`）
  - 其他角色列全部
  - 依案件分組，標 status badge（pending/merged/archived，對應顏色照 `app/(app)/logs/page.tsx` 的 STATUS map 風格）
- `app/(app)/field-reports/new/page.tsx` + `new-report-form.tsx` + `actions.ts`
  - 案場下拉（active cases）
  - 多行文字
  - 照片清單：每張獨立 caption 輸入（複用既有上傳模式，看 `app/(app)/logs/[id]/photo-actions.ts`）
  - 送出時 photos 寫進 `field-reports/<report_id>/<filename>` 路徑（雖然在 `daily-photos` bucket 內，但用 `field-reports/` 前綴避免跟日誌混）
- `app/(app)/field-reports/[id]/page.tsx` + 編輯
  - pending 且作者本人可編輯/刪除
  - merged 唯讀，顯示「已併入 [日期] 的施工日誌」連結

### 修改

- `lib/types.ts` — 新增 `FieldReport`、`FieldReportPhoto`、`FieldReportStatus`
- `app/(app)/layout.tsx` — `field_assistant` 的 navLinks 改為 `現場回報` + `我的回報`，移除 `/logs/new` 連結
- `app/(app)/logs/new/page.tsx` 與 `new-log-form.tsx`：
  - 撈 selected case 的 pending field_reports（包含 photos signed URL）傳進 form
  - 表單頂端加摺疊 panel「待整合的現場回報（N 筆）」，每筆 checkbox + 預覽
  - 按「合併到此日誌」：
    - 把勾選的 reports 的 `note` 以 `【YYYY-MM-DD HH:mm 王小明】<note>\n` append 進 `notes` textarea
    - 每張 photo（含原 caption）push 進日誌的 photos 陣列
    - 紀錄被勾的 report ids（hidden field）
  - 送出 server action（`logs/new/actions.ts`）時：transactionally
    - 寫 daily_log
    - update field_reports set status='merged', merged_into_log_id=…, merged_by=auth.uid(), merged_at=now() where id in (…)
- `app/(app)/logs/new/page.tsx` 的 role guard：維持現狀只允許 `site_supervisor` 進，因為合併動作就是主任的職責

## 不做的事（明確排除）

- 案場↔人員指派表（先列全部 active）
- 通知（push、email、LINE，全部不做）
- 已合併的 report 編輯 / 反合併
- 多 report 互相關聯
- LINE 整合（POC 不做，留 Phase 5）
- 改動既有四關 enum 或既有日誌資料

## 驗收檢查項

- [ ] field_assistant 登入後，nav 只看到「現場回報 / 我的回報」，看不到「新增日誌」
- [ ] field_assistant 可以新增回報（案場、文字、多照片＋各自 caption）
- [ ] field_assistant 可以看自己的清單，可改可刪 pending 的
- [ ] site_supervisor 在 `/logs/new` 選好案場後，看到該案場的 pending 回報區塊
- [ ] 勾選後按合併，textarea 跟照片區同步出現內容
- [ ] 送出日誌後，被合併的 reports status 變 `merged`
- [ ] 同一張照片在 daily_logs 跟 field_reports 兩邊都能看（同 path）
- [ ] RLS 仍是 POC 簡化版，但 TODO 註解寫好正式版規則

## 開發注意

- **branch**：`claude/restructure-construction-log-R2gvO`（已存在於 yumindb/admin）
- **commit 顆粒**：建議拆 `migration` / `types` / `field-reports pages` / `logs integration` / `nav` 五個 commit
- **不要直接跑 migration**：寫好 SQL push 上去，請使用者貼到 Supabase SQL Editor 跑
- **不要開 PR**，使用者自己決定何時 merge
- **照 AGENTS.md**：Next.js 是這個 repo 的 fork，先看 `node_modules/next/dist/docs/` 的對應 guide 再寫
- **欄位命名 snake_case（DB）/ camelCase（TS）**
- **TIMESTAMPTZ 不用 TIMESTAMP**
