# Supabase Migration 執行順序

新環境或重建時依此順序跑;現有環境只跑沒跑過的。所有檔案都冪等(可重複跑)。

| # | 檔案 | 用途 | 狀態 |
|---|------|------|------|
| 1 | [`schema.sql`](schema.sql) | 6 張表 + enum + RLS + auth trigger | 必跑 |
| 2 | [`fix-auth-3.sql`](fix-auth-3.sql) | 修 auth.users 8 個 token 欄位 NULL → '' (新版 Supabase 必要) | 若手動 INSERT auth.users 後失敗才跑 |
| 3 | [`seed-accounts.sql`](seed-accounts.sql) | 建 3 個 POC 帳號(office / supervisor / owner)| POC 環境跑 |
| 4 | [`storage.sql`](storage.sql) | 建 daily-photos + signatures bucket | 必跑 |
| 5 | [`migration-2.1.sql`](migration-2.1.sql) | daily_logs 加 extra_items + unsigned_items jsonb | 必跑 |
| 6 | [`migration-2.2.sql`](migration-2.2.sql) | daily_logs 加 vendor_notices text | 必跑 |
| 7 | [`migration-2.3.sql`](migration-2.3.sql) | daily_logs 加 current_stage approval_stage(四關正式流程,取消 auto-pass) | 必跑 |
| 8 | [`migration-2.4.sql`](migration-2.4.sql) | daily_logs 加 pdf_path + 建 daily-log-pdfs bucket(核定後自動產 PDF) | 必跑 |
| 9 | [`migration-2.5.sql`](migration-2.5.sql) | approval_stage enum 加 'fill'(填表人簽名) | 必跑 |
| 10 | [`migration-2.6.sql`](migration-2.6.sql) | user_role 加 'field_assistant'(現場助理)+ profiles.is_active 停用旗標 | 必跑 |
| 11 | [`migration-2.7.sql`](migration-2.7.sql) | field_reports 表(現場回報)+ field_report_status enum + RLS | 必跑 |
| 12 | [`migration-2.8.sql`](migration-2.8.sql) | daily_logs.photos 從 `string[]` 轉成 `[{path, caption}, ...]`(每張照片可填說明) | 必跑(已有資料時) |
| 13 | [`migration-2.9.sql`](migration-2.9.sql) | daily_log_revisions 表(送出後編輯的 audit trail)+ RLS | 必跑 |
| 14 | [`migration-2.10.sql`](migration-2.10.sql) | role-based RLS(取代 POC `poc_authenticated_all`)+ daily_log_revisions 收緊只 INSERT + storage 翻 private + path 限定 `auth.uid()/...` + signed URL 流程 | 必跑(取代 storage.sql 的舊 policy) |

## 排錯

### 「Could not find the 'X' column of 'daily_logs' in the schema cache」
→ 對應的 migration-X.X.sql 沒跑。對照上表跑該支即可。

### 「Database error querying schema」(登入失敗)
→ `seed-accounts.sql` 用了舊寫法,跑 `fix-auth-3.sql` 補 8 個 token 欄位 = ''。新 seed-accounts.sql 已修正,新環境不會再中。

### 工項進度沒更新 / 累計完成 = 0
→ 檢查日誌 status 是否為 `submitted` 或 `approved`(草稿 / 退回不計入)。

## 已棄用(不要再跑)

| 檔案 | 為何不用 |
|------|---------|
| `fix-auth.sql` | trigger pattern 修法,實際根本不是 trigger 問題,留檔當歷史紀錄 |
| `fix-auth-2.sql` | enum 權限修法,同上,真實原因是 token 欄位 NULL |
