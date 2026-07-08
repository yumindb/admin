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

---

## Phase 2.1 — 對齊真實日誌格式 + 工項進度 (2026-04-26)

### 一、對應裕民現有「內部施工日誌格式.xlsx」

讀過 Phil 提供的真實日誌表 (`裕民現有資料/表單/內部施工日誌格式.xlsx`),六大區塊:
1. 依施工計畫書執行 → 我們已有 `work_items`
2. 外包人員及機具 → 暫用 `manpower` 簡化(POC),Phase 3 擴展
3. 通知協力廠商 → 暫合併到 `notes`
4. 非合約內施工項目 → ✅ 新增 `extra_items jsonb`
5. 未簽約施工內容 → ✅ 新增 `unsigned_items jsonb`
6. 重要事項紀錄 → `notes`

### 二、工項數量加「百分比模式」

**2.1.1 為什麼**
- 標單單位是「組/式/套/個/處」時,1 組可能跨多天才做完。supervisor 想記「今天做了 30%」而不是「0.3 組」(對使用者反直覺)。
- 讀 site-supervisor-sim 與 Evelyn 都認同這需求。

**2.1.2 設計**
- `DailyLogWorkItem.qty_mode?: "absolute" | "percent"` — 預設 absolute
- 預設依 unit 自動切換:`{組,式,套,個,處,批,戶,棟,件,台,部,項,座,間}` → percent
- 儲存時:**`qty` 永遠是「絕對量」**(unit 自然單位)。percent mode 下 `qty` 是 0-1 fraction(50% = 0.5)。
- UI 顯示:percent mode 下輸入框值 ×100,旁邊顯示 `%`;切換 mode 時 qty 重置避免「30 米」被當成「30%」。
- 累計計算(progress)時 percent 要乘上「契約數量」還原成絕對量再 sum。

**2.1.3 邊界**
- 同一工項在不同日誌可以混用 mode(罕見但允許);總和都正確,因為一律以絕對量加總。
- 累計 > 契約量(>100%)用銅金色標示「超量」(可能漏報、誤填、或追加的數量)。

### 三、案件 detail 顯示「累計完成」進度

**2.1.4 計算範圍**
- 只計入 `status IN ('submitted', 'approved')` 的日誌。
- 草稿不計入(supervisor 還在編輯)。
- 退回的日誌:目前不計入(rejected 不在 IN list)。Phase 3 思考是否要計入 rejected 之前的版本(但被退回後 supervisor 應該會修正後重送,所以實務上沒影響)。

**2.1.5 為什麼放在 case detail 既有的工項表**
- supervisor-sim 提的需求是「在案件那邊看到已被登記完成的項目」,做一張獨立報表頁太重。
- 在現有 `WorkItemsTree` 加一欄「累計完成」最自然 — 用 `progress?: ProgressMap` prop 控制顯示。
- 顏色:0% 灰、50% 以下銅金、50-99% 琥珀、100% 松綠、>100% 銅金(超量)。

**2.1.6 為什麼用 jsonb 不另開表**
- 跟 Phase 2 的 `work_items` 同樣理由(2.2 章)。
- Trade-off:跨案統計每個工項當月完成量需要 jsonb 展開查詢;現階段量小不痛。Phase 3 量大時可改 normalize。

### 四、合約外 / 未簽約項目

**2.1.7 為什麼用 jsonb 不另開表**
- 同上。每份日誌的 extras / unsigned 加起來也就 0-5 筆,不會大。
- 結構彈性:未來欄位調整不用 migration。
- 缺點:沒法 cross-log 查「某主任今年回報的所有未簽約項目」,需要 `jsonb_array_elements` 展開。Phase 3 量大時改表。

**2.1.8 schema 欄位**
```
extra_items jsonb     [{name, unit?, qty?, headcount?, location?, requested_by?, reason?}]
unsigned_items jsonb  [{name, unit?, qty?, headcount?, category?: 點工|變更追加, quote_amount?, reason?}]
```
都 default `'[]'::jsonb`,already-existing logs 兼容。

**2.1.9 UI 復用**
- `ExtraItemsEditor<T>` 為 generic,接 `ColumnDef<T>[]` + `empty: T` template。
- 兩個 section 一個用 `EXTRA_COLS` 一個用 `UNSIGNED_COLS`,共用 component。
- 唯讀檢視用 `ExtraItemsTable<T>`,在 log detail / approval detail 共用。

### 五、Phase 2.1 已知限制 / Phase 3 TODO

1. **天氣沒拆 上午/下午** — 真實表有但 POC 維持單欄。Phase 3 改 `weather jsonb {am, pm}`。
2. **外包人員及機具沒做** — `manpower` 仍是 `{own, contract}` 簡化版。真實表有「工別 + 機具」,Phase 3 擴展。
3. **通知協力廠商沒獨立欄位** — 合進 `notes`。
4. **四級簽章圖** — 真實表底部要 工地主任 / 填表人員 / 審核人員 / 審定人員 / 核定人員 五個簽章區。POC 只有「核定」一關真的簽,其他 auto-pass 沒簽。Phase 2 正式版要做。
5. **跨日誌查詢效能** — jsonb 展開查每個工項當月進度,目前 case detail 是讀全部日誌再 sum。資料量大(>500 日誌)會慢。Phase 3 加 materialized view 或 normalize 表。

---

## Phase 2.2 — 下一步引導 + guidance-reviewer subagent (2026-04-26)

### 一、為什麼

裕民第一次用內部系統,使用者按完按鈕常不知道「接下來會發生什麼」。設計原則:每個 CTA 上方/下方輕輕提示一句,不擋畫面、不搶焦點。

### 二、共用元件 `<NextStepHint>`

`components/next-step-hint.tsx`,4 種 tone:
- `info`(預設米白 + 銅金 left border):一般引導
- `success`(松綠):已完成 / 確認狀態
- `warning`(琥珀):需注意/補做
- `muted`(灰):純說明

**新增 hint 一律用此元件**,不要直接寫 `<div>`。

### 三、目前覆蓋範圍

- `/cases/new` 表單底:建立並匯入 vs 只建立 的差別
- `/cases/[id]` 工項已建+無日誌:提示工地主任去填
- `/cases/[id]/import` Step 3:重複匯入合併規則
- `/logs/new` 送出按鈕上方:草稿 vs 送出 差別
- `/logs/[id]` 4 種狀態(draft / submitted / rejected / approved)各有對應 hint;`submitted` 依 owner / 非 owner 分支
- `/approvals/[id]` 簽核 CTA 上方:簽完跳下一份 + 退回切分頁

### 四、guidance-reviewer subagent

`.claude/agents/guidance-reviewer.md` — 跟 office-staff-sim / owner-sim / site-supervisor-sim 同類獨立 reviewer。

**為什麼選 subagent 不是 skill:**
- skill 是使用者主動觸發、操作步驟導向
- subagent 是獨立 audit 視角,跟現有 sim 同模式
- 每次 UI 改動後 invoke 它檢查 hint 覆蓋率

**用法:**任何頁面 / 狀態 / 流程改動後,以 general-purpose agent invoke,給它 reviewer.md 的 path 與改動範圍,它會列 ✓ / ❌ / ⚠ 三類回報。

### 五、設計原則(寫在 reviewer.md)

- 位置:在 CTA 上方/下方,目光自然會掃到處
- 時機:當下狀態才出現,已完成不要再叫使用者做事
- 長度:1-2 句、< 60 字
- 語氣:對話感(「老闆會收到通知」優於「通知已送出」),不用「您」「請貴」
- 不要擋畫面:inline banner / hint card,不要 modal / overlay
- 不重複 CTA label

### 六、本輪 audit 結果

reviewer 跑了一輪 checklist,找到 1 個必補 + 1 個建議補 + 4 個 ⚠,都已修正:
- ✅ `/cases/[id]/import` Step 3 改用 `<NextStepHint>`(原是純 `<p>`)
- ✅ `/logs/[id]` submitted 依 role 分支(owner / 其他)
- ✅ case-form / approval / submitted hint 都縮短到 < 50 字

---

## Phase 2.3 — 四關正式簽核流(取消 auto-pass) (2026-04-26)

### 一、為什麼

POC 階段為簡化只走「supervisor 送出 → owner 核定」,中間 review + audit 兩關 server action 自動寫 approved 跳過。客戶反饋:正式環境不能跳。本階段把所有三關都做成需要對應角色手動點。

### 二、四關流程

```
draft →[submit]→ submitted+review
              →[supervisor 通過]→ submitted+audit
              →[office_staff 通過]→ submitted+approve
              →[owner 通過 + 簽名]→ approved
              →[任一關退回]→ rejected →[supervisor 編輯重送]→ submitted+review
```

(填表本身是「supervisor 寫日誌按送出」,所以實際是 1 個填表動作 + 3 個簽核動作 = 4 關。)

### 三、Schema 決策

**2.3.1 新增 `daily_logs.current_stage approval_stage` nullable**
- submitted 時表當前在哪關;draft / approved / rejected 時為 null
- 不擴增 `log_status` enum(維持 4 個值清晰),用 `(status, current_stage)` pair 表示更彈性
- 加 partial index `WHERE current_stage IS NOT NULL` 加速「我這關該做什麼」查詢

**2.3.2 backfill 既有 submitted = 'approve'**
- POC 階段 auto-pass 已寫了 review + audit 兩個 approvals,所以舊 submitted 邏輯上只剩 owner 那關
- migration-2.3.sql 內 `update ... set current_stage = 'approve'` 一行搞定

### 四、Server Action 設計

**2.3.3 統一 `approveStageAction` / `rejectStageAction`**
- 取代原本只有 owner 用的 `approveLogAction` / `rejectLogAction`
- 內部:
  1. 撈 user 的 role
  2. 撈 log 的 current_stage
  3. 用 `STAGE_FOR_ROLE` map 驗證 role 對應 stage(不對就拒絕)
  4. 通過時推進到 `NEXT_STAGE[current_stage]`,若推進結果為 null(approve 通過)就 status='approved'
  5. 退回時直接 status='rejected', current_stage=null
- 只有 approve 階段強制簽名;review/audit 階段簽名是選填

**2.3.4 為什麼不分開三個 action(approveReview / approveAudit / approveApprove)**
- DRY:三個 stage 邏輯 95% 相同(寫 approval 紀錄 + 推進 stage)
- 角色驗證集中在一處,容易檢視
- 加新 stage(例如未來 #22 監工複審)只需加 enum + map,不用加 action

### 五、UI 決策

**2.3.5 `/approvals` 列表 role-aware,不開三個獨立路由**
- 三個角色看到的「我該做什麼」都在同一個 URL,網址簡單
- 內部 query 用 `STAGE_FOR_ROLE[role]` 過濾
- supervisor 額外加 `eq("supervisor_id", user.id)` 只看自己日誌(複核 = 自核)

**2.3.6 Nav 三個角色都顯示自己的待辦 link,但用詞不同**
- supervisor:「待複核」
- office_staff:「待審核」
- owner:「待核定」
- 內部都指向 `/approvals`,page 自動切換內容

**2.3.7 review/audit 不簽名,approve 簽名**
- approval-actions.tsx 用 `requireSignature = stage === "approve"` 切換 UI
- review/audit 階段顯示「這關不需簽名圖」+ 選填備註 textarea + 一顆通過按鈕
- approve 階段保留原本 260px 簽名板 + touch-action: none
- ⚠ 已被 2.5.1 取代:四關都收簽名

**2.5.1 四關都收手寫簽名(填表人 / 複核 / 審核 / 核定)**
- 業主回饋:既然有手寫板,每關都該留底,不只老闆。
- migration-2.5.sql 把 `approval_stage` enum 加 `'fill'`(在 review 之前)
- 填表人簽名:`new-log-form.tsx` 在送出時必填(草稿可省),簽完後 `saveLogAction`
  寫一筆 `log_approvals` (stage='fill', decision='approved')
- approval-actions.tsx 拿掉 `requireSignature` 切換,所有關卡都顯示簽名板 +
  選填備註 textarea
- approveStageAction 對所有 stage 都檢查 `signatureUrl`
- PDF 簽核紀錄區塊 STAGE_LABEL 加 `fill: "填表(工地主任)"`,
  四個簽名圖會依時序排列

### 六、guidance-reviewer 抓到的 5 個 issue 已修

1. ✅ owner nav 缺「施工日誌」入口 — 補上
2. ✅ `/logs` 列表 status badge label「待核定」過時 — 改「簽核中:複核/審核/核定」
3. ✅ `role === "approve"` typo — 改 `=== "owner"`
4. ✅ approve 階段「前往簽核」用詞不一致 — 統一「前往核定」
5. ✅ review/audit 通過 UI 視覺份量輕 — 加一行「這關不需簽名圖,點按鈕推進到下一關」收尾

### 七、Phase 3+ TODO

- 「自核」checkbox(supervisor 送出時可勾「我自己複核」一鍵跳過 review):PROJECT.md 提到的選項,目前 POC 不做
- supervisor 看別人的日誌(跨主任協同):目前 supervisor `/approvals` 只看自己的,Phase 3 看公司怎麼分工
- 退回後重送是否要保留歷史版本:目前 supervisor 編輯後 status 直接從 rejected → submitted+review,前一輪的 log_approvals 紀錄保留但日誌內容已覆寫

---

## Phase 2.13 — 合約外 / 未簽約 升等為案件級工項 (2026-05-03)

### 一、為什麼

POC 階段 合約外 / 未簽約 是 `daily_logs.extra_items` / `unsigned_items` jsonb 內的 free-form 列表 —
**每份日誌獨立**、沒跨日誌身份、沒進度、沒報價欄位整合。

業主回饋:這兩種工項也要能像合約內工項一樣被填寫累計進度、之前出現過的下次能直接勾選、辦公室能事後補報價、簽約後要能歸到合約外。

### 二、Schema 決策(migration-2.13)

**2.13.1 把 合約外/未簽約 升等為案件級工項**
- `work_item_type` enum 加 `'extra'`(合約外、已簽約追加)+ `'unsigned'`(未簽約)
- 視為 `case_work_items` 的一等公民,跟 `'item'` 共享 unit_price / quantity / progress 等所有欄位
- `daily_logs.work_items` jsonb(原本只放合約內 picker 的勾選)現在也吃 extra/unsigned 的 work_item_id —
  寫入時不需要區分 type,讀取時透過 join `case_work_items.item_type` 拆三組
- 這樣 site-supervisor-sim / 累計完成 / 100%自動隱藏 / percent mode / 月報 全部「免費」復用

**2.13.2 新欄位**
```
case_work_items
  + quote_status text             待報價/已報價(僅 extra/unsigned 用,有單價即視為 quoted)
  + contract_signed_at timestamptz 未簽約 → 合約外的時間戳
  + contract_note text             簽約備註(必填,例:「2026-05-08 LINE 同意追加」)
  + created_by uuid                哪個 profile 建的(標單匯入為 null)
```

**2.13.3 舊資料相容**
- `daily_logs.extra_items` / `unsigned_items` jsonb **保留不刪**,讓升等前的舊日誌仍能 read-only 顯示
- log detail / approval detail / 案件總覽 / 月報 都加了「(舊)…」section,只在資料存在時渲染
- 新日誌 jsonb 一律寫 `[]`(saveLogAction 內 payload.extraItems / payload.unsignedItems 收 client 傳的空陣列)

### 三、權限與流程

**2.13.4 新增臨時項權限放到三角色都可**
- `createExtraOrUnsignedAction` 接受 site_supervisor / office_staff / owner — 用 Phil 確認的「現場主任填日誌時可即時新增,辦公室助理/老闆編輯日誌或案件總覽也能新增」
- 編輯/刪除/標記簽約 仍限 office_staff / owner

**2.13.5 簽約流程**
- 未簽約必須先填單價(quote_status='quoted')才能標記簽約
- 標記簽約 = `markUnsignedAsSignedAction`:必填 contract_note + 設 contract_signed_at + 翻 item_type 'unsigned' → 'extra'
- UI:案件總覽未簽約區塊每列有「標記簽約」按鈕,彈 dialog 收備註

**2.13.6 picker 自動隱藏完成**
- `WorkItemsPicker` 已內建「累計達標單量則隱藏」邏輯(`isWorkItemCompleted`)
- extra/unsigned 走同一份 `priorAggregates` map,因此「填過一次 → 之後仍可勾;100% 完成 → 自動消失」是免費的

### 四、UI 整合

**2.13.7 三 picker / 三 section**
- /logs/new 與 /logs/[id]/edit:section 4 「合約外」+ section 5「未簽約」改用 `WorkItemsPicker`(原 `ExtraItemsEditor` 退役)
- 新增臨時項按鈕在 picker 上方;點開 `AddTempWorkItemDialog` → 立即 server insert → return id → useState append 到 picker items 並打勾,user 可立刻填本日數量
- 案件總覽 /cases/[id]:`WorkItemsTreeSection` 之下加 `ExtraUnsignedSection` × 2(extra / unsigned)
  - office_staff / owner 看到「+ 新增 / 編輯 / 刪除 / 標記簽約」操作
  - 共用 `WorkItemEditModal`,新增 `extraUnsignedKind` prop 切換到對應模式(隱藏「上層分類」、改 server action)

**2.13.8 樹狀只顯示合約內**
- 案件總覽 `WorkItemsTreeSection` 不再渲染 extra/unsigned(避免「未分類層」變成假 root section)
- TreeItem 的 itemType 仍是窄 union(`section/item/spec/manual`),case detail 在 map 進去時 cast(因為已先 filter)
- 案件統計卡片(Stat)從 4 卡改為:工項總數 / 已登記日誌 / 合約外項目 / 未簽約項目

### 五、Phase 3+ TODO

1. 月份性「未簽約 → 合約外」轉換報表(office_staff 結帳用)
2. 報價金額審核流程:目前 office_staff 直接編輯 unit_price,沒簽核;Phase 3 可考慮加 owner 確認單價
3. 合約外 / 未簽約 沒有 section/parent 概念,扁平。若未來工項數爆量,可加 tag/分類欄位
4. localStorage 草稿 key 升 v3,舊草稿(v2)會被忽略 — 影響:升級時若 supervisor 有未送出的 free-form 草稿會看不到,需要重填

---

## Phase 2.20 – 2.23 — GPS 打卡 (2026-05-16)

### 一、為什麼

業主回饋:工地主任、現場人員 應該要有 GPS 打卡，能證明確實到工地現場（薪資 / 工程證據 / 信任）。POC 階段 (`docs/PROJECT.md`「POC 不做」清單) 明列「打卡」延後，現在 Phase 2 已穩定，正式補上。

裕民跨案件設計（2026-05-11 已拍板:主任可看所有案件）讓打卡 UI 必須允許主任跨案選擇而非鎖定指派。

### 二、七項關鍵決策（Evelyn 與我對話確認後採用，全照推薦）

| # | 決策 | 採用值 | 理由 |
|---|---|---|---|
| D1 | geofence 硬擋 vs 軟警告 | **軟警告** | 工地門牌不準、GPS 飄移;硬擋會逼工人造假 |
| D2 | 上下班強制配對 | **不強制**，UI 提示 | 工地實況亂，硬規則會被罵 |
| D3 | 無案件 / 在公司打卡 | **允許**，case_id=null + note 必填 | 主任會跑多工地，禁了就沒人用 |
| D4 | 預設 geofence 半徑 | **200 m**（10–5000 可調） | 透天工地夠用;大工地由 office 調 500 m+ |
| D5 | 隱式戳記是否需要同意 | **首次彈一次同意，沿用瀏覽器 permission** | 一次告知符合台灣個資法 |
| D6 | 是否做地圖視覺 | **第一版不做**，顯示文字距離 + Google Maps link | 開發成本明顯較高，先驗證需求 |
| D7 | 打卡資料保留多久 | **永久** | 薪資 / 工程證據用 |

### 三、Schema 決策

**2.20.1 cases 加 lat/lng/geofence_radius_m**
- `numeric(9,6)` 給經緯度（6 位小數 ≈ 11 公分精度）
- `geofence_radius_m int default 200 check (1-5000)`
- DB constraint `cases_latlng_paired`:lat/lng 必須同時 null 或同時有值（避免半填）
- 沒有座標的案件仍可運作（打卡時 distance=null, within_geofence=null）

**2.21.1 attendance_events 為 immutable event log**
- 故意不開 UPDATE / DELETE policy → 打卡是證據，要修改只能再 INSERT 新事件
- INSERT 限 `user_id = auth.uid()`（不能代打卡）
- SELECT 開放給所有 authenticated（與 supervisor cross-case 設計一致）
- 同時記錄 distance_m + within_geofence(server 端用 evaluateGeofence 算)— 寫入時固定，避免案件之後改座標導致歷史紀錄飄移

**2.21.2 case_id 允許 null + note 必填的執行層**
- DB 層不擋（避免日後流程改動要動 schema）
- server action 邏輯:`!case_id && !note → reject`
- 取捨:DB constraint 更嚴格但較不彈性;邏輯層擋容易隨需求調整

**2.22.1 隱式戳記僅在「首次送出」寫入**
- daily_logs: 只有 `intent === "submit"`（draft → submitted 或 rejected → submitted）才寫 submit_*
- post_edit:**完全不寫** — 保留原始送出位置，否則編輯就能改證據
- field_reports: 只 create 時寫，update 時不寫

### 四、Client 隱式定位策略（D5 對應）

`useSilentLocationOnce` 在 `lib/use-geolocation.ts`:
- 先 query `navigator.permissions.geolocation`;`state !== "granted"` 直接 return
- 沒有 Permissions API 的瀏覽器（部分 Safari 版本）才會 fallback 呼 getCurrentPosition
- 失敗永遠靜默（不彈錯誤、不擋送出）

結果:使用者第一次到 `/attendance` 才會被詢問;之後 `/logs/new`、`/field-reports/new` 就免擾自動戳記。

### 五、UI 整合點

| 位置 | 功能 |
|---|---|
| 底部 tab（site_supervisor + field_assistant） | 「打卡」icon（clock） |
| `/attendance` | 顯式上下班打卡 + 推薦最近案件 + 今日時間軸 |
| `/logs/new` 送出時 | 隱式戳記 submit_lat/lng |
| `/field-reports/new` 送出時 | 同上 |
| `/cases/[id]` | 近 14 天案件出勤時間軸 |
| `/reports/attendance` | 全公司出勤報表 + 篩選 + xlsx 匯出 |
| 案件 form（new + edit） | 座標 picker（Google Maps URL 貼上 + Leaflet 點選） |

### 六、地圖實作:Leaflet + OpenStreetMap

- 用 `leaflet`（純 vanilla，無 react-leaflet）+ 動態 import + ssr: false，bundle 只在 picker 載入時下載
- Tile 來源:OpenStreetMap（零成本，符合 D6 不做付費地圖 API 的決策）
- Marker 用 inline SVG（深海軍藍 pin + 銅金中心），避免 webpack 對 leaflet 預設 PNG 路徑的問題
- Circle overlay 顯示 geofence 範圍視覺化

**故意不做**:
- 反向地理編碼（座標 → 地址）:成本（Google US$5/1000 calls）vs 價值（office 已可手動標 location 欄位）不對等
- 案件詳情打卡點地圖視覺:第一版用文字距離 + 個別 Google Maps link，第二版再評估

### 七、Phase 3+ TODO

1. **離線打卡**(PWA + IndexedDB)— 工地訊號爛時打卡失敗 = 漏卡。Phase 2.24 或更後做（取決於離線送日誌一起做的時機）
2. **LIFF 整合**:從 LINE 開打卡頁可拿到 LINE user ID + 訊號更穩；attendance_events.source 已預留 `'liff'`
3. **未下班提醒** — 晚上 21:00 cron 掃當天上班但沒下班的人 → LINE 推播
4. **批簽 / 月結時自動帶出勤** — 老闆審月薪時直接看到 X 主任本月在 OO 工地的出勤時數
5. **地圖視覺**:`/reports/attendance` 加切換「地圖模式」，顯示打卡點散佈 + heatmap
6. **GPS 防偽強化**:目前只信任瀏覽器值（瀏覽器假 GPS / DevTools 可改）。要真防偽需 LIFF + LINE Login binding，或要求每次打卡拍一張照（人像+環境）
7. **批次修正歷史座標**:若案件座標填錯，目前已寫入的 distance_m / within_geofence 不會自動重算（這是 immutable event log 的特性）。Phase 3 加管理介面手動重新計算

---

## Phase 2.24 — 離線打卡前景排隊 (2026-05-16)

### 一、為什麼不做 Service Worker

原本提案是 Service Worker + IndexedDB + BackgroundSync。深入評估後改做純前景排隊，理由:

1. **iOS Safari 不支援 BackgroundSync API** — 工地主任多 iPhone 用戶，做了 SW 也解不了「app 關閉時自動送出」的核心問題
2. **Next.js 16 + next-pwa 相容性風險** — 16 才剛出，PWA 工具鏈未跟上，SW 容易踩 caching 邊界
3. **實際情境** — 主任打卡 → 離開工地（訊號好）→ 隨手開 app 一下 → 就 flush。前景排隊已足夠涵蓋

### 二、設計

`lib/offline-clock-queue.ts`:
- IndexedDB `yumin-offline-clock` / `pending_clocks` store
- `enqueue` / `listPending` / `remove` / `bumpAttempts` 四個原子 API
- `MAX_ATTEMPTS = 5`,超過後保留但不再自動重試(避免無限重試 server 端拒絕的事件)

觸發 flush 的時機:
1. `/attendance` mount 時
2. `window` 觸發 `online` event 時
3. 使用者手動點「立即重試」

判斷該排隊 vs 該直接報錯:
- `navigator.onLine === false` → 不打 server,直接排
- server action throw → 用 `isOfflineErrorMessage(msg)` heuristic 判斷:net/fetch fail 排隊;業務 error(權限不足、validation)報給使用者
- server action 回 `{ok:false}` → 業務錯誤,不排隊(重試也不會成功)

### 三、何時不可用

- 隱私瀏覽模式(IndexedDB 受限) — `enqueue` catch + 顯示「不支援」提示
- 多裝置使用同帳號:queue 是裝置-local 的;手機排了 5 筆，從電腦不會看到

### 四、Phase 3+ 真正的 PWA

若未來 iOS 支援 BackgroundSync 或公司全面 Android,可加:
- Service Worker + manifest.json + 可安裝 PWA
- BackgroundSync API 處理「tab 關閉時也能送」
- 配合「離線送日誌」一起做(scope 較大)

---

## Phase 2.25 — 地址 geocoding + CasePicker 距離排序 (2026-05-17)

- 案件 form 貼「地址」也能取得座標（`lib/geocode.ts`），不一定要貼 Google Maps URL 或點地圖。
- 打卡頁 CasePicker 依「目前位置 → 各案件座標」距離排序，最近的工地排最前。
- 無 migration（沿用 2.20 的 cases.lat/lng）。細節見 commit cbca055。

---

## 2026-05-21 ~ 05-24 批次 — 備份、請假、帳號登入、儀表板、營運硬化

> 32 commits（a9e2c05 → f789020）。本節記錄非顯而易見的決策；完整清單看 git log 該區間。

### 一、每日備份 → Cloudflare R2（`.github/workflows/backup.yml`）

- **為什麼放 GitHub Actions 不放 Vercel cron**：Hobby plan cron 限制（見下）+ pg_dump 需要完整環境。
- 每天 02:00 台北（UTC 18:00）：pg_dump 全 public schema → gzip → R2；三個 storage bucket（daily-photos / signatures / daily-log-pdfs）rclone 同步；db 備份保留 90 天自動清理。
- **pg_dump 版本必須 17**：GitHub runner 預設 16.14，server 是 17.6，版本不合會失敗 — workflow 強制把 pg17 binaries 放 PATH 開頭（commit 67ce89b）。
- **Supabase S3 相容層要 `no_check_bucket`**（rclone），否則 listing 失敗（commit 6ad8217）。
- 失敗通知 email（Gmail SMTP，收件 yumindb@gmail.com + evelyn.evagor@gmail.com；GitHub Secrets `NOTIFY_EMAIL_USER` / `NOTIFY_EMAIL_APP_PASSWORD`）。
- **週一 heartbeat email**：備份成功且當天是週一才寄，內容含過去 7 天完成率 + R2 用量 — 「沒收到 🚨 就是健康」需要一封定期的正面確認，否則沉默 = 壞掉也沒人知道。
- 細節與還原步驟見 `docs/BACKUP.md`。

### 二、帳號（username）登入取代 email（commit 676de1f）

- 工人記不住 email；帳號規則 `/^[a-z0-9]{2,30}$/`。
- **實作是轉換層不是 schema 改動**：Supabase Auth 仍存 `<username>@yumin.local`；`lib/auth/username.ts` 提供 `usernameToEmail` / `emailToUsername`（顯示時反轉，非 @yumin.local 後綴則原樣顯示）。未來要改真 email 只需拔掉轉換層。

### 三、請假（migration-2.23；`/leaves`）

- **簽核鏈依申請人 role 自動決定**（`lib/leave.ts`）：
  field_assistant → supervisor → office_staff → owner；supervisor → office_staff → owner；office_staff → owner；**owner 不能申請**（最高關）。
- 狀態機：pending（current_step 逐關推進）→ approved / rejected / cancelled（申請人 pending 期間可撤回）。退回不能改單重送，要開新單。
- RLS：申請人本人 + office_staff + owner 可見；supervisor 只看自己的 + 自己在簽核鏈上的。不開 DELETE。

### 四、Dashboard + 營運報表（commits 0952af6, 8e6af09）

- `/dashboard`（owner / office_staff）四卡：待核定（含等最久天數）、進度落後案場（<30% 且開工 >60 天）、今日未打卡主任、本月追加金額。上方紅色異常 banner：退回 >2 天未重送、active 案件 >5 天無新日誌。
- 案場健康燈（`lib/case-progress.ts`）：紅 = 進度落後 或 合約外/未簽約 ≥5 筆；黃 = 有合約外項目 或 近 5 天無日誌；綠 = 其他。
- `/reports/today-attendance` 紅黃綠出勤（紅 = 今日沒打卡；黃 = 缺上/下班或超出範圍；綠 = 完整且在範圍內）。
- `/reports/sign-delays`：用 log_approvals.created_at 串 timeline 算各關處理時長 + Top 10 等最久。

### 五、卡住日誌強制處理（migration-2.24；commit 0267898）

- owner / office_staff 可對卡住日誌繞過正常關卡：**≥7 天可強制退回、≥30 天可強制刪除**（門檻是 code 常數）。
- 強制退回寫進 log_approvals（comment 帶「[強制退回·卡 N 天] 原因」）；強制刪除靠 **migration-2.24 的 daily_logs DELETE audit trigger** 把 before_values 留進 audit_logs — 刪除必留證據。
- 照片/PDF 不同步刪，交給每日 cleanup-orphan-photos cron。

### 六、資料留存（retention）cron（commit 7e62578）

- `lib/retention.ts`：login_attempts 30 天、daily_log_revisions 365 天、audit_logs 365 天。
- **掛在既有 `/api/cron/recheck-stuck-pdfs` route 內執行**，因為 Vercel Hobby 只給 2 個 cron — 新排程工作優先併入既有 route，不要加 vercel.json cron（會 silent deploy failure）。
- audit_logs 沒有 DELETE policy（使用者不可竄改），清理用 service-role。

### 七、離線與手機體驗

- `/field-reports/new` 加 localStorage 草稿（400ms debounce）+ IndexedDB 離線佇列（`lib/offline-report-queue.ts`，同打卡佇列的前景 flush 模式：mount / online event / 手動重試）。
- 未簽約工項 picker 上限解除（commit 5326c81）：**業主要求追加工項不設上限但 % 照算**。之前 client 設 totalQuantity=null 會在 refresh 後被 server 端撈回的預估量蓋掉 — 修法是在 new-log-form 入口把未簽約 PickerItem 的 totalQuantity 一律 null。
- 全站表單回饋改 sonner toast（inline banner 會被 router.refresh 沖掉）；觸控目標全面 ≥44px。

### 八、文案規範（commit 9044f58，87 檔 700+ 處）

- 中文 UI 一律**全形標點**（，：（）），排除 regex / URL / 比例 / 純英文字串。
- 語氣：客氣、說明後果、用「您」。新寫 UI 字串照此規範。

### 九、其他

- 「現場助理」正名為「**現場人員**」（field_assistant，commit bf99b4a）。
- field_assistant 進 `/cases` 直接 redirect `/my-cases`（RLS 會讓他看到空列表，很困惑）。
- 簽核簽名可重用（批簽一張簽名共用）。

---

## 2026-07-04 批次 — 登入/操作紀錄、到期提醒、案件大事記、結案閘門

> 業主方向:使用便利、案件追蹤、帳號使用追蹤。migration-2.25。

### 一、登入紀錄 `/reports/logins`（migration-2.25）

- **資料層本來就有**:login_attempts（2.17 速率限制用）每次成功/失敗都寫一筆,本批只加 user_agent + ip 欄位跟管理頁。
- recordAttempt 寫入帶**降級 fallback**:migration 沒跑時新欄位 insert 會失敗 → 自動退回基本欄位 insert,登入永不因紀錄失敗而壞(已在本地對 production 驗證)。
- retention 拆成**失敗 30 天 / 成功 365 天** — 成功紀錄就是登入史,30 天全刪這頁就沒意義。
- ⚠ 順手修了一個舊 bug:retention 清 login_attempts 用了不存在的 `created_at` 欄(實際是 `attempted_at`),**每晚清理其實默默失敗**,cron route 有回傳 error 但沒人看。教訓:cron 內部的 per-step error 要有人消費(此路徑已修正欄名)。
- 連續失敗 ≥3 次的帳號在頁面頂部紅色 banner 列出 — 免費的「有人在猜密碼」警報。

### 二、操作紀錄 `/reports/audit`

- audit_logs(2.19/2.24)一直只寫不讀,只能 SQL 查。此頁是純唯讀檢視,零 schema 改動;SELECT RLS 本來就限 office_staff/owner,直接用一般 client。
- before/after 值以「欄位中文名:舊 → 新」逐欄渲染,role/boolean 轉中文,timestamptz 轉台北時間。

### 三、Dashboard 到期卡 + /staff 最後登入

- `cases.expected_end` 從初版 schema 就存在但沒有任何 UI 用它。新卡:紅 = 已逾期、黃 = 7 天內到期。日期比對用台北時區字串（date 欄位,避免 UTC 差 8 小時邊界）。
- /staff 的最後登入來自 `auth.users.last_sign_in_at`(listUsers 本來就會回),不用 login_attempts。

### 四、案件大事記（/cases/[id]）

- 把日誌簽核（含退回）、追加合約、未簽約項新增/簽約、現場回報、標單匯入、案件建立合併成一條時間軸,cap 50 筆。
- 退回的日誌不在案件頁原本的 logs query 裡(只撈 submitted/approved),所以簽核事件用 `log_approvals` + `daily_logs!inner(case_id)` 直接以 case_id 過濾,不依賴 logs 清單。
- 純呈現元件 `components/case-timeline.tsx`,資料組裝留在 server component。

### 五、結案流程 + 防漏財閘門（cases/[id]/status-actions.ts）

- **`case_status` enum 有 closed 但 UI 從沒做過結案** — 本批補上。
- 結案前 `getCloseChecklistAction` 攤開:未簽約項目（未報價的最危險）、簽核中日誌、草稿、待處理回報。有錢未收時 dialog 轉紅色 destructive、按鈕文字變「我了解，仍要結案」— **軟性警告不硬擋**（與 geofence D1 同哲學）。
- 「有單價即視為已報價」沿用 2.13 慣例。
- 已結案案件自動從 /logs/new、打卡 CasePicker、案件列表預設篩選消失（它們本來就只撈 active）,可重新開啟。

### 六、CI 修復 + lint 基線

- **main 的 CI 其實一直是紅的**（react-hooks v6 的 React Compiler 規則上線後 33 個 error 沒人理,lint step exit 1）。
- 處理:`_work/**` 一次性腳本加入 ignore;`purity` / `set-state-in-effect` / `preserve-manual-memoization` 三條降為 **warn**（purity 對 async Server Component 是誤報;既有 setState-in-effect 是運作中行為,整批重構風險大於收益）;真錯誤（prefer-const、錯位的 eslint-disable、global-error 的 `<a>`）修掉。
- 原則:**新程式碼看到這些 warning 仍應避免**,別讓 warn 數量繼續長。

### 七、測試補強

- 新增 leave（簽核鏈/推進/時數/可簽判定）、username（schema/雙向轉換/round-trip）、tender-parser（四類分類規則/樹狀 parent/千分位/兩種表頭格式）共 30 個單元測試,總數 51 → 81。

---

## 2026-07-08 上線前整備 — 全角色測試、PostgREST 截斷修復、Demo 資料

> 正式上線前夕。用真實空白標單重建 demo 資料時,揭露兩個潛伏 bug。

### 一、⚠ PostgREST 1000 筆靜默截斷（lib/db/fetch-all.ts）

- **Supabase 預設 max-rows = 1000,超過的列被「默默丟掉」,不報錯。**
  POC 期測試資料總量小(全庫 case_work_items 只有 458 列)從未觸發;
  匯入真實「配電盤空白標單1140616」單案就 1236 列,以下全部靜默漏資料:
  案件列表統計、案件詳情工項樹、日誌 picker、審核頁漏填檢查、
  **重複匯入 dedupe(會造成重複插入!)**、Excel 匯出、dashboard、跨案報表。
- 修法:`lib/db/fetch-all.ts` 的 `fetchAllRows()` — range 分頁、50 頁安全上限、
  要求穩定排序(呼叫端一律加 `.order("id")` tiebreak,避免分頁重複/漏列)。
- **規範:任何「撈整個案件或跨案件的 case_work_items / daily_logs」查詢必須走
  fetchAllRows。**新頁面照抄現有 caller 的寫法。
- 教訓:測試資料要用「真實尺寸」的資料 — demo seed 從此改用真實標單匯入。

### 二、manual 工項不計進度

- 所有進度迴圈只認 `item/spec`,`manual`(無標單小案的手動工項)被跳過 →
  純手動案件進度永遠顯示「—」。案件列表 / dashboard / cases-overview /
  跨案 Excel 四處一併修正。unsigned/extra 仍不計進度(它們是錢的追蹤,不是工程量)。

### 三、老闆手機版沒有現場回報入口

- 桌機 nav 與頁面權限一直都允許 owner,只有 `navByRole` 的 owner mobileTabs
  漏了 `/field-reports` — 手機上等於看不到也不能建。補上共 6 tab。
- 教訓:權限開了不等於入口有了;每個角色的 desktopNav / mobileTabs 要成對檢查。

### 四、Demo 資料策略（_work/seed-demo-launch.mjs,gitignored 本機腳本）

- 全清所有 POC 測試資料(帳號保留),用真實空白標單重建 4 案件:
  配電盤(1111 項,含各簽核狀態日誌 + 未簽約 + 滲水回報)、管線(EMT+PVC 兩次
  匯入)、泵浦(**故意空案件** — demo 現場示範匯入)、竹北李宅(manual 工項 +
  追加合約 + 5 天後到期)。
- 日期全部相對「跑腳本當天」— **demo 當天早上重跑一次腳本,所有日期就會
  對齊當天**(冪等,先全清再重建)。
- 座標:金華街用 Nominatim 街道級 geocode(約略),正式使用時 office 用地圖
  picker 校正。
- ⚠ date 欄位字串一律用 `toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" })`,
  不能用 `toISOString().slice(0,10)`(UTC 會往前偏一天)。

### 五、全角色×裝置 手動測試結論(2026-07-08)

- owner 桌機(dashboard/簽核/案件/報表/人員)+ 手機(6 tab、回報可看可建)✓
- site_supervisor 手機(日誌五狀態、新日誌 1234 項 picker + 搜尋、打卡、請假)✓
- office_staff 桌機(dashboard、審核詳情、人員最後登入)✓
- field_assistant 手機(打卡/案場/回報/新增/請假 5 tab)✓
- migration-2.25 已由 Evelyn 套用,/reports/logins 有真實裝置/IP 資料。

---

## 2026-07-08(續)— 線上使用說明書、辦公室補登打卡(migration-2.26)

> 現場 demo 取消,改為線上說明書 + 系統內指引。員工多不熟電腦,設計原則:
> 「每一步都不需要額外學習或記憶」。

### 一、使用說明書 `public/manual.html`

- **放在系統本身**(`/manual.html`,public 靜態檔,免登入)而非發檔案 — 
  入口:header 的「?」圖示(全角色全裝置)、登入頁 footer、/account 頁。
  好處:永遠是最新版、不用傳檔、手機點開即看。
- 結構:10 章(快速開始/功能地圖/現場/主任/辦公室/老闆/共同/小功能索引/FAQ/疑難排解)。
  「功能地圖」= big picture(角色×功能格狀圖,點了跳小節);
  「我想要…」任務式捷徑給不會描述功能名稱的使用者。
- **全文搜尋**:純前端 index(章/小節/FAQ),標題命中 > 內文、小節 > 整章。
- **AI 朗讀**:Web Speech API(`speechSynthesis`,zh-TW、rate 0.95),每節「朗讀」
  按鈕 + 頂欄全域停止。零成本、離線可用、不依賴外部 TTS 服務;
  裝置不支援時 fallback alert。已實測 speaking=true。
- 文字原則:國小程度句子、每步一個動作、「接下來畫面會…」預期說明、
  狀態表(草稿/簽核中/已核定/已退回)用顏色徽章對齊系統 UI。

### 二、辦公室補登打卡(migration-2.26)

- **寫說明書時發現的缺口**:打卡頁/回報頁 UI 寫著「請聯絡辦公室手動補登」,
  但補登功能根本不存在(INSERT policy 限本人、lat/lng NOT NULL、source 無 manual)。
  UI 不可以承諾不存在的路徑 — 教訓:寫文件是最好的功能盤點。
- 設計:RLS 不開放代打(現場打卡=本人,證據性);補登走 server action +
  service-role + requireRole(office/owner) + **note 必填留原因** + source='manual'。
  時間軸標「辦公室補登(無 GPS)」、Excel 多「來源」欄,與現場 GPS 打卡永遠區分。
- migration-2.26:lat/lng 改可空 + source check 加 'manual'。未套用前補登會
  回友善錯誤,不影響其他功能。

### 三、系統內指引

- 登入頁「POC 試用」字樣移除(上線了),改「帳號由辦公室建立 · 忘記密碼請找
  辦公室助理重設」+ 說明書連結。
- 原則重申:能在系統內一句話講完的,不要叫使用者去翻說明書;
  說明書負責「第一次學」與「出狀況查」,NextStepHint 負責「當下這一步」。

