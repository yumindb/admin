# Yu Min Admin — 開發決策記錄

> 這份檔案紀錄 POC → 正式版過程中**不顯而易見**的設計決策。
> 程式碼能說明 *what*；這裡解釋 *why*。每進一個 Phase 追加一節，舊節保留勿改。

---

## Phase 1 — Schema + Auth + 標單匯入 + 案件管理 (2026-04-26)

### 一、Schema 關鍵決策

**1.1 `profiles.company` 用單欄位 hardcode '裕民'**
- 提案曾討論「員工跨公司」是否需要 `profile_company` 多對多。
- POC 結論：先單欄位 `text` 預設 '裕民'，三家公司共用一個 instance，案件用 `cases.company` 自帶。員工跨公司由 admin 開案時指派處理（Phase 2 補 admin 介面）。
- 升級路徑：未來改多對多時，把 `profiles.company` 設為 main_company，新增 `profile_companies` 關聯表，現有資料零破壞遷移。

**1.2 `approval_stages` 暫不建表，POC 用固定 enum**
- 原計畫做動態 approval_stages 表保留 #22 監工彈性。
- POC 簡化：建 `approval_stage` enum (`review`/`audit`/`approve`)，POC 只用 `approve`。
- 待 Phil 拍板 #22 監工後，Phase 2 再決定要不要做動態表。動態化時，把 `log_approvals.stage` 改成 `stage_id` FK，enum 廢棄。

**1.3 `case_work_items` 用一張表 + `parent_id` + `sort_path` + `depth` + `item_type` enum**
- 階層深度可達 6（`壹.二.10.1.4.24`），closure table 太重；adjacency list + materialized path 是甜蜜點。
- `sort_path` 採 zero-padded segment（每段 4 碼，如 `0001.0002.0010.0001`），保證 `ORDER BY sort_path ASC` 出來就是樹的 DFS 順序。
- `item_type`: `section`（分類層、不可填量）/ `item`（工項，可填量）/ `spec`（item 下規格子項，可填量）/ `manual`（系統手動補項）。

**1.4 `case_work_items.modified_by_user` boolean — 重複匯入不覆蓋**
- 為了支援「Phil 給原版 → 後來追加版」的合併匯入（office-staff-sim 提的關鍵需求），需要區分「是匯入帶進來的」vs「使用者後來改過」。
- 規則：dedupe key = `(case_id, tender_code, name)`；若 dup 且 `modified_by_user = true` → skip update；否則 update。新項一律 insert。
- Phase 2 補 work_item 編輯 UI 時，UI 上每次 save 要把 `modified_by_user = true`。

**1.5 RLS — POC 用 `poc_authenticated_all`，每張表上方留正式版 TODO**
- 為了讓 Evelyn 1.5 天能 deploy 給客戶看，RLS 簡化到「authenticated 都能讀寫」。
- `schema.sql` 每張表上方註解都寫了正式版該長什麼樣（profiles 看自己 / cases 跟著 supervisor 指派 / daily_logs 看自己 / log_approvals 跟隨 logs）。
- Phase 2 第一週要把這些 TODO 兌現，否則三公司資料會洩漏。

**1.6 `auth.users → profiles` 自動建立 trigger**
- `handle_new_user()` 在 `auth.users` 插入時自動補 `profiles`，避免「Supabase Dashboard 建帳號→profile 不存在→login 後 layout 抓不到 role」的 race。
- 帳號用 `raw_user_meta_data` 帶 `full_name` / `role`；POC seed 的 3 個帳號就是這樣建的。
- 用 `search_path = ''` (空) + 完全 schema-qualified 引用 (`public.profiles`, `public.user_role`) 是 Supabase canonical pattern，建議比照（雖然 v1 用 `search_path = public` 也能跑，但 GoTrue 對 SECURITY DEFINER 函數的 introspection 更嚴）。

**1.7 ⚠ Manual `INSERT INTO auth.users` 必須帶所有 *_token 欄位 = `''`**
- Supabase 新版的 `auth.users` 對 `confirmation_token` / `recovery_token` / `email_change_token_new` / `email_change` / `email_change_token_current` / `phone_change` / `phone_change_token` / `reauthentication_token` 這 8 個欄位:**值是 NULL 時 GoTrue 會 panic** (Go 端 `Scan error: converting NULL to string is unsupported`),登入時回 "Database error querying schema"。
- 這些欄位的 default 通常是 NULL,所以 `INSERT` 不指定就會踩雷。
- 解法:`INSERT` 時顯式給 `''`(空字串)。`docs/seed-accounts.sql` 已修正。
- 此問題與 `handle_new_user` trigger 無關 — 即使 trigger 完美也會失敗。troubleshooting 時先看 Supabase Dashboard → Logs 找實際 Postgres 錯誤,不要先動 trigger。
- 已知 fix 腳本:`docs/fix-auth-3.sql`(對現有 row UPDATE 補 `''`)。

### 二、標單 parser 邊界處理

**2.1 標單 7 欄固定格式，無 AI、純規則 parser**
- 範例（EMT管空白標單.xlsx / 泵浦空白標單1140304-N.xlsx）證實格式高度規律。
- `lib/tender-parser.ts` 只用「項次有無」+「單位/數量有無」+「層級深度」三個訊號分流。
- 預估準確率 90-95%；剩下的靠 Preview UI 給 user 校對 + 勾「略過」。

**2.2 spec / section / item 認定規則**
- 有項次 + 沒單位/數量 + 深度 ≤ 4 → `section`（如 `壹.二.10` 機電工程、`壹.二.10.1` 電氣設備工程）
- 有項次 + 有單位/數量 → `item`（如 `壹.二.10.1.4.24 EMT管 E19`）
- 沒項次 + 有單位/數量 → `spec`（屬上一個 item，如 EMT管下的多種尺寸）
- 沒項次 + 沒單位 → `skip`（小計、空白行、表頭重複、雜訊）

**2.3 多行 cell 換行保留**
- xlsx 的 cell 內換行（`\n`）在泵浦標單第 11 列有大量出現（規格描述）。
- parser 把整段 `name` 原樣保留並寫入 `case_work_items.name`；UI 用 `whitespace-pre-line` 還原。
- 若 name 內含 `\n`，同步寫一份到 `spec_text` 欄供未來搜尋／顯示分離用。

**2.4 重複匯入合併 key = `(case_id, tender_code, name)`**
- 不是純項次比對，因為 `spec` 列項次是空的。
- 不是純名稱比對，因為「EMT管 E19」可能在多個 section 出現。
- 用「項次 + 名稱」雙鍵：section 改名不會撞、spec 撞名不同 section 不會誤合（因為 name 含上下文）。
- 邊界：若兩次匯入的同 item 在 sheet 內位置變了，sort_path 會被新 import 覆寫；不打架（client 修改不在 sort 上）。

**2.5 sort_path 在 server-side 會被 import 覆蓋**
- client 預覽時生的 sort_path 直接帶到 server，server 寫入時連同 parent_id 重建。
- 重複匯入時若 row 順序變了 → existing row 的 sort_path 會被新值蓋掉（這是預期行為，使用者顯示順序跟標單一致）。

### 三、UI 復用元件

**3.1 `WorkItemsTree` (`components/work-items-tree.tsx`) — preview 與 detail 共用**
- 接 `TreeItem[]` 扁平陣列（含 `parentId`），元件內重建樹。
- 透過 prop `showSkippedToggle` 切換 preview 模式（顯示「略過」勾選）vs detail 模式（純展示）。
- 預設展開規則：section / item 展開、spec 收起；preview 模式下用 `defaultExpandSpecs` 可改。
- detail page 直接從 DB 撈 `case_work_items` 餵進去；preview 從 parser 結果 `flattenTree(parsed.tree)` 餵進去。

**3.2 `ImportPreview` (`components/import-preview.tsx`) — 三步驟 client-only**
- Step 1 上傳 → Step 2 預覽（client-side parsing，檔案不傳到 server）→ Step 3 確認匯入（server action）。
- 解析在瀏覽器做的好處：parse 失敗 user 立刻看到、不浪費 server 時間、不需要 storage bucket（Phase 2 要存 .xlsx 時再加）。
- Server action `confirmImportAction` 接到的是已 normalize 過的扁平節點 + sort_path。

**3.3 `(app)/layout.tsx` 是所有登入後頁面共用 shell**
- App Router 的 route group `(app)` 包住所有受保護路徑，讓 `/login` 可以有自己的 layout（無 nav）。
- shell 內做了一次 `supabase.auth.getUser()` + `profiles` 撈 role/company，子頁不用再撈一遍（透過 props 傳或重撈）。

### 四、Auth / Routing

**4.1 `middleware.ts` → `proxy.ts`**
- Next.js 16 把 `middleware` 慣例改名為 `proxy`，舊名會 warn。
- 所有 supabase auth refresh + redirect 邏輯放 `lib/supabase/middleware.ts`，proxy.ts 只是 thin wrapper。

**4.2 Login 用 Server Action，不開 API route**
- `app/login/actions.ts` 的 `loginAction` 直接呼叫 Supabase + redirect。
- 不需要 `/api/auth/login` route；Server Action 內 `redirect('/')` 比 client-side router.push 更穩（Next 處理 cookie）。

### 五、已知限制 / Phase 2 TODO

1. **RLS 完全 wide-open** — 任何 authenticated user 可讀寫所有資料。Phase 2 第一週兌現 schema.sql 內的 TODO。
2. **沒做 storage bucket** — 標單 .xlsx 解析後直接丟掉（不存原檔）。Phase 2 加 `tender-files` bucket + signed URL，避免使用者「想看當初匯的 .xlsx」時找不到。
3. **手動補項 / 編輯 work item UI 還沒做** — `item_type = 'manual'` 預留欄位，但沒有「+ 新增工項」「編輯工項」UI。Phase 2 的「無標單小案」需求要靠這個。
4. **沒做 work_item_library** — 提案說的「跨案累積詞典」在 Phase 1 不做，純依匯入累積。Phase 3 才補 library + normalize。
5. **approval_stages 沒建表** — 用 enum 暫代。Phil 拍板 #22 監工後再決定要不要動態化。
6. **`profiles.company = '裕民'` hardcode** — 三公司共用 instance 的 UI 沒做。Phase 2 admin 介面再補。
7. **`tender_imports.file_path` 永遠是 null** — 因為沒有 storage。
8. **沒有 daily_logs UI** — schema 預留結構，Phase 2 才做填寫 UI（手機 first）。
9. **沒有簽核 UI** — `log_approvals` 同上。
10. **Excel parser 沒測過邊界 sheet**（多 sheet、隱藏列、合併 cell）。範例兩份檔案都單一 sheet 結構乾淨；Phase 2 拿 Phil 給的 19 份其他標單測。
11. **重複匯入時 `modified_by_user` 永遠 = false** — 因為還沒有編輯 UI 把它設為 true。Phase 2 補完編輯後此欄才開始發揮作用。

---

## Phase 2 — 施工日誌 + 老闆簽核 (2026-04-26)

### 一、角色導向

**2.1 三個 role 三個首頁**
- `office_staff` → `/`(案件列表)
- `site_supervisor` → `/logs`(我的日誌)
- `owner` → `/approvals`(待簽核)
- 在 `app/(app)/page.tsx` 第一行做 `redirect()`,nav 也照 role 條件渲染。
- 三個 role 都可手動切到其他頁(POC RLS 全放),正式版要 RLS + 路由 guard。

### 二、日誌 schema 與簽核流

**2.2 daily_logs.work_items 用 jsonb 不是另一張表**
- 結構:`[{ work_item_id, qty, note }]`。
- 用 jsonb 的原因:同一份日誌寫一次就好,不用 N 次 INSERT;查詢用 `?` operator 也夠用。Phase 3+ 若要做「跨案統計每個工項當月完成量」可以再 normalize 成 `daily_log_work_items` 表。
- TS 型別:`DailyLogWorkItem` 用 `work_item_id`(snake)而非 camelCase,讓 client picker → server action → DB 一條路不需轉換(踩過坑;見 git c90693c 後的 follow-up)。

**2.3 POC 兩關 auto-pass**
- 工地主任送出時,server action 自動寫兩筆 `log_approvals`:
  - `stage='review' decision='approved' approver_id=supervisor_id` (自核)
  - `stage='audit' decision='approved' approver_id=null`
- daily_logs.status 直接從 `draft` → `submitted`,等老闆 `approve`。
- 正式版這兩關要分別由 supervisor / office_staff 操作。enum 已經預留三 stage,擴充時改 server action 與 UI 即可,DB 不動。

**2.4 老闆簽核走 `/approvals`,不是 `/logs`**
- 兩條路徑分開:`/logs/[id]` 是「看細節」、`/approvals/[id]` 是「動手簽」。同 log 兩個視角不同。
- `/approvals/[id]` 開啟時若 status 已不是 `submitted`(別人搶簽過了),redirect 回 `/logs/[id]`。

**2.5 簽完跳下一份 vs 回列表**
- `nextPendingRedirect()` server action 撈下一個 submitted 的 log,有就 redirect 過去,沒有就回列表。
- 為什麼放 server action:client 知道哪個 log 已簽完不準(可能其他人剛搶簽);server 撈最即時。
- 副作用:沒有「全部簽完了 ✓」的 celebratory state,直接落到列表的 empty state。Phase 2.5+ 可加。

### 三、Storage 與照片

**2.6 Storage bucket POC 是 public**
- `daily-photos` + `signatures` 都是 public bucket。
- 為什麼:demo 階段直接用 `getPublicUrl` 顯示最快,不用 signed URL。
- 風險:照片 URL 如果外洩任何人都能看(構造 URL 較難但可能)。Phase 3 改 private + signed URL(每次發 URL 帶 60s 過期)。
- 路徑慣例:`{user_id}/{timestamp}-{rand}.{ext}`,避免衝突。

**2.7 簽名圖以 dataURL 上 server action 後再轉 Buffer**
- react-signature-canvas 出 PNG dataURL,client 直接傳給 server action 解 base64 上傳。
- 為什麼不 direct upload:server action 裡可以驗證 user 身份再上傳,且簽名圖小(< 50KB)不需要分段。

### 四、Sim 驗收後修正

**2.8 site-supervisor-sim 提的 high severity 已處理**
- ✅ 觸控目標 ≥ 44px(整列可點切換、stepper 按鈕 size-10、min-h-[56px] row、checkbox 變視覺裝飾、整列吃 hit area)
- ✅ 天氣改 6 個 chip 按鈕(晴/多雲/陰/小雨/大雨/雨停),不用打字
- ✅ 數量 stepper(±1 按鈕),戴手套也能按
- ✅ localStorage 自動存草稿(每 600ms debounce 寫,進頁面自動還原,儲存/送出後清掉)
- ✅ 照片並行上傳 + 進度條 (X/Y + bar)
- ⏳ 未做(Phase 3):離線送出、照片 client 端壓縮、複製昨日日誌、工項搜尋、手機 nav

**2.9 owner-sim (Phil) 提的 high severity 已處理**
- ✅ 簽名板 180px → 260px + `touch-action: none`(避免簽名時整頁捲動)
- ✅ 退回原因 5 個 preset chips(照片不夠清楚 / 工項數量怪 / 請補拍 / 工項漏報 / 備註不清楚),自由輸入也保留
- ✅ approve/reject 按下立即 disabled,防止訊號慢時雙擊重送
- ⏳ 未做(Phase 3):批簽、簽過記錄查詢、手機底部 tab bar、退回也記簽名

### 五、已知限制 / Phase 3 TODO

1. **RLS 仍 wide-open** — 跟 Phase 1 同。
2. **沒有 LINE 通知** — 老闆要主動開 web 才看得到待簽核。Phase 5 整合 LINE OA。
3. **照片是 public bucket** — 見 2.6。
4. **批簽未做** — Phil 明確提到希望可以一次簽 5 份,Phase 3 做。
5. **離線送出未做** — 工地主任訊號爛時送出失敗 = 資料丟。需要 Service Worker + IndexedDB 排隊。
6. **複製昨日日誌未做** — supervisor 重複工作的需求。
7. **工項搜尋未做** — 標單 200+ 項時 picker 滑很久。Phase 3 加搜尋框。
8. **`work_items` 沒做完整 normalize** — jsonb 內存的 `work_item_id` 沒 FK 約束,工項被刪掉會變 dangling pointer。Phase 3 改 normalize 表 + RESTRICT。
9. **沒有「我簽過的」歷史頁** — Phil 說想查證自己簽過什麼,目前要靠 SQL。
10. **中間兩關真的 auto-pass** — 不是 mock,是實際寫進 log_approvals。Phase 2 正式版要把這兩關分給對的角色操作。
