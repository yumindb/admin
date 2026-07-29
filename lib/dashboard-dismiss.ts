/**
 * 儀表板警示「先不理」的天數(migration-2.30)。
 *
 * 刻意是「暫時」而不是永久:退回未重送 / 案件停滯代表真的有東西卡住,
 * 永久隱藏等於把問題藏起來。時間到會自動再冒出來。
 *
 * 放這裡而不是 actions.ts:"use server" 檔案只能匯出 async function。
 */
export const DISMISS_DAYS = 7;

export const DISMISSIBLE_ALERT_KINDS = ["rejected", "stale"] as const;
export type DismissibleAlertKind = (typeof DISMISSIBLE_ALERT_KINDS)[number];
