import type { UserRole } from "@/lib/types";

/**
 * 通知偏好(分類開關)— 純函式模組,client / server 都可 import,有測試。
 *
 * 規則(2026-07 業主需求):
 *   - 通知拆成 5 個分類,由老闆 / 辦公室助理在 /staff 幫每個人設定
 *   - 沒設定過的人走「角色預設」:
 *       owner / office_staff   → 全開(他們是簽核主力)
 *       site_supervisor / field_assistant → 全關(被設定可通知才收得到)
 *   - 儲存在 line_bindings.notification_prefs jsonb(migration-2.28):
 *       null            = 從未設定 → 全走角色預設
 *       { "分類": bool } = 有明確值的分類用明確值,缺的 key 走角色預設
 *   - 這層只管「分類開關」;個人的總開關 notifications_enabled(暫停通知)
 *     與是否已綁定 LINE 在 notify.ts 另外判斷
 */

export const NOTIFICATION_CATEGORIES = [
  {
    key: "logs_to_review",
    label: "日誌待簽核",
    description: "有日誌等這個人審核／核定時通知",
  },
  {
    key: "log_results",
    label: "日誌結果",
    description: "自己送出的日誌被核定或退回時通知",
  },
  {
    key: "leaves_to_review",
    label: "請假待簽核",
    description: "有請假單等這個人簽核時通知",
  },
  {
    key: "leave_results",
    label: "請假結果",
    description: "自己送出的請假被核准或退回時通知",
  },
  {
    key: "field_reports",
    label: "現場回報",
    description: "有人新增現場回報時通知",
  },
] as const;

export type NotificationCategory =
  (typeof NOTIFICATION_CATEGORIES)[number]["key"];

export const CATEGORY_KEYS = NOTIFICATION_CATEGORIES.map(
  (c) => c.key,
) as NotificationCategory[];

/** 每個 event_type 屬於哪個分類(events.ts 送出的每種事件都要在這裡登記) */
export const EVENT_CATEGORY: Record<string, NotificationCategory> = {
  log_submitted: "logs_to_review",
  log_to_approve: "logs_to_review",
  log_batch_to_approve: "logs_to_review",
  log_approved: "log_results",
  log_batch_approved: "log_results",
  log_rejected: "log_results",
  leave_submitted: "leaves_to_review",
  leave_advanced: "leaves_to_review",
  leave_approved: "leave_results",
  leave_rejected: "leave_results",
  field_report_created: "field_reports",
};

/** 角色預設:owner / office_staff 全開,主任 / 現場人員全關 */
export function roleDefaultEnabled(role: UserRole): boolean {
  return role === "owner" || role === "office_staff";
}

export type NotificationPrefs = Partial<Record<NotificationCategory, boolean>>;

/**
 * 這個人這個分類到底收不收?
 * 明確設定過 → 用設定值;沒設過 → 角色預設。
 */
export function isCategoryEnabled(
  prefs: NotificationPrefs | null | undefined,
  role: UserRole,
  category: NotificationCategory,
): boolean {
  const explicit = prefs?.[category];
  if (typeof explicit === "boolean") return explicit;
  return roleDefaultEnabled(role);
}

/** 給 UI 用:算出每個分類目前的生效值(明確值 + 角色預設補洞) */
export function resolvePrefs(
  prefs: NotificationPrefs | null | undefined,
  role: UserRole,
): Record<NotificationCategory, boolean> {
  const out = {} as Record<NotificationCategory, boolean>;
  for (const key of CATEGORY_KEYS) {
    out[key] = isCategoryEnabled(prefs, role, key);
  }
  return out;
}
