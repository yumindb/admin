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
- ⚠ **必須用 `search_path = ''` (空) + 完全 schema-qualified 引用 (`public.profiles`, `public.user_role`)。**寫 `search_path = public` 簡化會讓 Supabase GoTrue 登入時報 "Database error querying schema"。需 `grant ... to supabase_auth_admin` 讓 GoTrue 能 introspect。詳見 `docs/fix-auth.sql` 與 `schema.sql` 內註解。

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
