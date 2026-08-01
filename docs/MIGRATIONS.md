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
| 10 | [`migration-2.6.sql`](migration-2.6.sql) | user_role 加 'field_assistant'(現場人員)+ profiles.is_active 停用旗標 | 必跑 |
| 11 | [`migration-2.7.sql`](migration-2.7.sql) | field_reports 表(現場回報)+ field_report_status enum + RLS | 必跑 |
| 12 | [`migration-2.8.sql`](migration-2.8.sql) | daily_logs.photos 從 `string[]` 轉成 `[{path, caption}, ...]`(每張照片可填說明) | 必跑(已有資料時) |
| 13 | [`migration-2.9.sql`](migration-2.9.sql) | daily_log_revisions 表(送出後編輯的 audit trail)+ RLS | 必跑 |
| 14 | [`migration-2.10.sql`](migration-2.10.sql) | role-based RLS(取代 POC `poc_authenticated_all`)+ daily_log_revisions 收緊只 INSERT + storage 翻 private + path 限定 `auth.uid()/...` + signed URL 流程 | 必跑(取代 storage.sql 的舊 policy) |
| 15 | [`migration-2.11.sql`](migration-2.11.sql) | daily_logs 加 `pdf_status` enum + `pdf_error` text(讓 PDF 背景生成的 generating / failed 狀態能在 UI 透明顯示)| 必跑 |
| 16 | [`migration-2.12.sql`](migration-2.12.sql) | cases.company / profiles.company 補成 3 家正式公司名 + default 改為「裕民工務企業有限公司」| 必跑(若有舊資料) |
| 17 | [`migration-2.13.sql`](migration-2.13.sql) | 合約外/未簽約升等為 case_work_items(work_item_type 加 'extra'+'unsigned';case_work_items 加 quote_status/contract_signed_at/contract_note/created_by) | 必跑 |
| 18 | [`migration-2.14.sql`](migration-2.14.sql) | 開放 site_supervisor INSERT case_work_items(限 item_type IN ('extra','unsigned'))— 解 2.13「新增臨時項 RLS 擋」 | 必跑(配 2.13) |
| 19 | [`migration-2.15.sql`](migration-2.15.sql) | field_reports 加 office_staff/owner DELETE policy(限 status='pending'/'archived')— 配 2026-05-08 業主回饋:辦公室助理可定期清掉處理過的回報 | 必跑 |
| 20 | [`migration-2.16.sql`](migration-2.16.sql) | extra_contracts 表(以「合約」為單位的追加合約)+ case_work_items.extra_contract_id FK + RLS;舊 'extra' 工項自動轉成單品項合約。配 2026-05-08「合約外 → 追加合約」需求 | 必跑 |
| 21 | [`migration-2.17.sql`](migration-2.17.sql) | login_attempts 表(登入速率限制)— 3 次失敗 15 分鐘鎖,配 2026-05-11 健檢 A5 | 必跑 |
| 22 | [`migration-2.18.sql`](migration-2.18.sql) | signatures bucket SELECT 收緊(只讀自己 folder)— 配 2026-05-11 健檢 B4(縮小) | 必跑 |
| 23 | [`migration-2.19.sql`](migration-2.19.sql) | audit_logs 表 + trigger(profiles / case_work_items 財務欄 / extra_contracts)— 配 2026-05-11 健檢 B1 | 必跑 |
| 24 | [`migration-2.20.sql`](migration-2.20.sql) | cases 加 lat / lng numeric(9,6) + geofence_radius_m int default 200(GPS 打卡基礎)| 必跑 |
| 25 | [`migration-2.21.sql`](migration-2.21.sql) | attendance_events 表(上下班打卡事件)+ RLS(read-all + insert-own,不可改/刪)| 必跑 |
| 26 | [`migration-2.22.sql`](migration-2.22.sql) | daily_logs / field_reports 加 submit_lat/lng/accuracy_m/distance_m/within_geofence(隱式 GPS 戳記)| 必跑 |
| 27 | [`migration-2.23.sql`](migration-2.23.sql) | leave_requests + leave_approvals 表(請假流程,簽核鏈依申請人 role 自動往上送)+ RLS | 必跑 |
| 28 | [`migration-2.24.sql`](migration-2.24.sql) | daily_logs 加 DELETE audit trigger(配「卡住日誌強制處理」功能,留證據誰刪了哪份日誌)| 必跑 |
| 29 | [`migration-2.25.sql`](migration-2.25.sql) | login_attempts 加 user_agent + ip(登入紀錄管理頁 /reports/logins)| 必跑 |
| 30 | [`migration-2.26.sql`](migration-2.26.sql) | attendance_events 支援辦公室補登(source 加 'manual'、lat/lng 可空)| 必跑 |
| 31 | [`migration-2.27.sql`](migration-2.27.sql) | LINE 通知:line_bindings(綁定碼流程)+ notification_queue(推播佇列)+ RLS(見 [`LINE.md`](LINE.md))| 必跑 |
| 32 | [`migration-2.28.sql`](migration-2.28.sql) | LINE 通知偏好:line_bindings 加 notification_prefs jsonb(白名單制分類開關,/staff 設定)| 必跑 |
| 33 | [`migration-2.29.sql`](migration-2.29.sql) | 核定關雙簽名:daily_logs 加 approve_signatures(兩位 owner 都簽才完成;race 用 compare-and-set)| 必跑 |
| 34 | [`migration-2.30.sql`](migration-2.30.sql) | 儀表板警示「先不理」:dashboard_dismissals(per-user、7 天後自動再提醒)+ RLS | 必跑 |
| 35 | [`migration-2.31.sql`](migration-2.31.sql) | 撤回核定:log_approvals 開放 office_staff/owner 寫「approve 關 + decision=rejected」的紀錄(順帶修好助理強制退回核定關日誌時軌跡寫不進去的洞)| 必跑 |

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
