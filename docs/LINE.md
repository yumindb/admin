# LINE 通知整合

> 2026-07 上線(Phase 5 第一部分:通知推播。LIFF 打卡尚未做)。
> 官方帳號:**@449ibxsb**(裕民工務,LINE Official Account Manager 管理)。

## 架構總覽

```
使用者(員工) ── 加官方帳號好友 → 傳 6 位數綁定碼
                                      │
LINE 平台 ──(webhook + X-Line-Signature)──▶ /api/line/webhook
                                      │        比對 line_bindings.binding_code
                                      ▼        寫入 line_user_id 完成綁定
server actions(簽核/請假/回報成功後)
   └─ after() ─▶ lib/notifications/events.ts(組 Flex 訊息)
                   └─▶ lib/notifications/notify.ts
                         寫 notification_queue → 去重 → push
                         失敗 → 夜間 cron 重試(最多 3 次,24h 內)
```

| 檔案 | 職責 |
|---|---|
| `lib/line/client.ts` | Messaging API wrapper(push / reply / 簽名驗證);env 沒設一律安全 no-op |
| `lib/line/flex.ts` | Flex Message 模板(品牌色、1 顆進系統按鈕、不含敏感資料) |
| `lib/line/binding.ts` | 綁定碼產生 / 格式判斷(純函式,有測試) |
| `lib/line/constants.ts` | OA ID、加好友連結、TTL(client 可 import,無 secret) |
| `lib/notifications/notify.ts` | 佇列核心:收件人解析、10 分鐘去重、送出、cron 重試 |
| `lib/notifications/events.ts` | 業務事件 → 通知(誰收、內容長怎樣都在這裡) |
| `app/api/line/webhook/route.ts` | webhook:follow / 綁定碼 / 解除綁定 / unfollow |
| `app/(app)/account/line-binding-card.tsx` | /account 綁定 UI |
| `docs/migration-2.27.sql` | line_bindings + notification_queue + RLS |

## 通知事件與收件人(三關簽核 fill → audit → approve)

| 事件 | 收件人 | 顏色 |
|---|---|---|
| 日誌送出 / 重送 | office_staff 全員 | amber |
| 辦公室審核通過 | owner | amber |
| 老闆核定通過 | 該日誌的主任 | green |
| 退回(含強制退回) | 該日誌的主任 | red |
| 批簽 | 彙總一則(「N 份待核定」/「你的 N 份已核定」) | — |
| 請假送出 / 推進 | 下一關角色(排除申請人) | amber |
| 請假核准 / 退回 | 申請人 | green / red |
| 現場回報 | office_staff(排除回報人) | amber |

實際收件人還要過三道過濾(依序):

1. **已綁定 LINE**(line_bindings.line_user_id 非空)
2. **總開關開啟**(notifications_enabled;本人可在 /account 暫停)
3. **分類開關**(migration-2.28,`notification_prefs` jsonb,白名單制):
   - 通知拆 5 類:日誌待簽核 / 日誌結果 / 請假待簽核 / 請假結果 / 現場回報
     (事件 → 分類對照見 `lib/notifications/prefs.ts` 的 `EVENT_CATEGORY`)
   - 由老闆 / 辦公室助理在 **/staff →「通知」按鈕** 幫每個人設定;
     可在對方還沒綁定前先設,綁定後生效
   - 沒設定過的人走角色預設矩陣(`ROLE_DEFAULT_PREFS`,2026-07-18 二修):

     | 分類 | owner | office | supervisor | field |
     |---|---|---|---|---|
     | 日誌待簽核 | ✓ | ✓ | — | — |
     | 日誌結果 | ✓ | — | — | — |
     | 請假待簽核 | ✓ | ✓ | — | — |
     | 請假結果 | — | ✓ | — | — |
     | 現場回報 | — | ✓ | — | — |

     主任 / 現場人員一律預設全關(白名單制);設定視窗的「套用建議值」
     會帶入 `ROLE_RECOMMENDED_PREFS`(主任=日誌結果+請假待簽核+請假結果;
     現場人員=請假結果)
   - /account 綁定卡會顯示本人目前會收到哪些分類(唯讀);
     /staff 名單有「LINE 已綁定/未綁定」欄位

## Rich Menu(依角色選單)

- 由 `scripts/line-rich-menu.mjs` 產生與部署:
  `node scripts/line-rich-menu.mjs render`(只產 PNG 預覽)/ `deploy`(需
  `LINE_CHANNEL_ACCESS_TOKEN` env;冪等,重跑會換新圖並清舊選單)
- 5 個選單:4 個角色(2×3 格,URI 按鈕連現有頁面)+ 1 個未綁定預設
  (完成綁定 / 使用說明書)。每個角色選單的 alias 固定
  (`yumin-role-<role>`),runtime 由 alias 解析 id(`lib/line/richmenu.ts`)
- 掛載時機:綁定成功 → webhook 掛角色選單;傳「解除綁定」→ 退回預設;
  /staff 改角色 → 自動重掛。**Rich Menu 免費,點擊不計訊息額度**
- 改選單內容:編輯 script 裡的 `ROLE_MENUS` 後重跑 deploy;已綁定使用者
  的選單指到 alias 背後的新 id,無需重綁(個人 link 指舊 id 的,重綁一次即可)

## ⚠ 訊息額度(成本)

- **推播(push)計入官方帳號每月訊息數;回覆(reply)免費。**
- 台灣方案:輕用量 **免費 200 則/月** → 中用量 NT$800/月 3,000 則 → 高用量 NT$1,200/月 6,000 則(僅高用量可加購)。
- 省額度設計:批簽彙總、10 分鐘去重、退回/核定只通知當事主任、可自行暫停通知。
- 若試用後常態超過 200 則/月,再評估升級中用量或砍事件(改法:`lib/notifications/events.ts` 移除對應呼叫點)。

## 環境變數

| 變數 | 用途 | 放哪 |
|---|---|---|
| `LINE_CHANNEL_SECRET` | webhook 簽名驗證 | Vercel env + `D:\Evelyn\_secrets\` |
| `LINE_CHANNEL_ACCESS_TOKEN` | 推播(long-lived token) | 同上 |
| `LINE_CHANNEL_ID` | 目前程式未用,留存備查 | 同上 |
| `APP_BASE_URL` | 通知按鈕連回系統的網址;不設預設 production 網址 | 不用設 |

**兩個金鑰都沒設時:通知寫入佇列標 `skipped`、webhook 收到請求直接回 200 不處理 — 可以先部署程式再補金鑰。**

## LINE 後台設定步驟(一次性)

1. **啟用 Messaging API**:
   [LINE Official Account Manager](https://manager.line.biz/account/@449ibxsb) → 右上「設定」→ 左側「Messaging API」→ 啟用。
   過程會要求選擇/建立 **Provider**(建議名稱:裕民工務 or Still Lab)→ 完成後這個 OA 會變成 LINE Developers 的一個 channel。
2. **拿金鑰**:[LINE Developers Console](https://developers.line.biz/console/) → 該 Provider → 該 channel:
   - 「Basic settings」tab → **Channel secret** → `LINE_CHANNEL_SECRET`
   - 「Messaging API」tab → **Channel access token (long-lived)** → Issue → `LINE_CHANNEL_ACCESS_TOKEN`
3. **設 webhook**:「Messaging API」tab:
   - Webhook URL:`https://yumin-admin.vercel.app/api/line/webhook`
   - **Use webhook 開啟**,按 Verify 應回成功(金鑰已設好並 redeploy 之後才驗)
4. **關掉會干擾的自動功能**(OA Manager → 設定 → 回應設定):
   - 聊天:關(或維持「回應模式:Bot」)
   - 自動回應訊息:關(不然使用者傳綁定碼會收到罐頭回覆 + 我們的回覆各一則)
   - 加入好友的歡迎訊息:關(webhook 的 follow 事件會回我們自己的引導文)
5. **Vercel** → Project Settings → Environment Variables → 加 `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`(Production)→ **Redeploy**。
6. 金鑰同步存一份到 `D:\Evelyn\_secrets\`(絕不進 repo)。

## 驗證流程(設定完後走一遍)

1. Evelyn 用自己帳號登入系統 → /account → 產生綁定碼。
2. 手機 LINE 加 @449ibxsb 好友 → 應收到歡迎引導(代表 webhook 通)。
3. 傳綁定碼 → 應回「綁定成功」。
4. 用測試主任帳號送一份日誌 → office_staff 綁定者應收到「新日誌待審核」卡片。
5. 傳「解除綁定」→ 應回「已解除綁定」。
6. 額度查詢:OA Manager 首頁可看本月已用訊息數。

## 疑難排解

- **Verify 失敗 / 傳訊息沒反應** → Vercel env 沒設或沒 redeploy;或 webhook URL 打錯。看 Vercel Functions log 的 `[line-webhook]`。
- **綁定成功但收不到推播** → `LINE_CHANNEL_ACCESS_TOKEN` 沒設/貼錯;查 `notification_queue`(status=failed 的 error 欄)。
- **通知沒送(佇列 skipped)** → 金鑰未設定;設好後「舊的 skipped 不會補送」(避免轟炸),之後的事件正常送。
- **一天只重試一次**:失敗通知靠夜間 cron 重試,超過 24 小時視為過時不再送。
