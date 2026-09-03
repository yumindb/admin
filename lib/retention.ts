import type { createServiceClient } from "@/lib/supabase/server";

/**
 * audit / log 表的 retention 清理工具,
 * 給 cron 呼叫(目前掛在 recheck-stuck-pdfs 路由,
 * Hobby plan 只能 2 個 cron,故併入既有 nightly 工作)。
 *
 * 為什麼有 retention:
 *   - login_attempts(失敗): 速率限制鑑識用,超過一個月沒人回查
 *   - login_attempts(成功): 就是「登入紀錄」(/reports/logins),留 1 年
 *   - daily_log_revisions: 日誌編輯軌跡,留 1 年足夠覆蓋稅務 / 爭議
 *   - audit_logs: 帳號 / 工項 / 合約變更,留 1 年同上
 *
 * 為什麼用 service-role:
 *   audit_logs / login_attempts 沒開 DELETE policy(一般使用者不可竄改)。
 *   cron 走 service-role 是唯一能清的路徑。
 *
 * ⚠ 時間欄位每張表不一樣,不要憑直覺寫 created_at:
 *   - login_attempts 是 attempted_at(2026-07 前用錯,清理一直沒生效)
 *   - daily_log_revisions 是 edited_at(2026-07-04 ~ 2026-09-03 用錯,cron 每天報
 *     column does not exist,編輯軌跡兩個月沒清;其他表因為 Promise.all 各自獨立不受影響)
 *   - audit_logs 是 changed_at
 *   對應關係由 lib/__tests__/retention.test.ts 釘住,改欄位先改 schema 再改測試。
 */

export const RETENTION_DAYS = {
  login_attempts_failed: 30,
  login_attempts_success: 365,
  daily_log_revisions: 365,
  audit_logs: 365,
  // 站內消息只是「把人帶去看意見」的信封,意見正本永遠在 log_approvals,
  // 90 天後這個信封沒有留存價值(未讀的也一樣 — 三個月沒看就不會看了)
  app_messages: 90,
} as const;

export type RetentionResult = {
  table: string;
  cutoff: string;
  deleted: number | null;
  error: string | null;
};

export async function cleanupOldLogs(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<RetentionResult[]> {
  return Promise.all([
    deleteOlderThan(supabase, "login_attempts", "attempted_at", RETENTION_DAYS.login_attempts_failed, {
      success: false,
    }),
    deleteOlderThan(supabase, "login_attempts", "attempted_at", RETENTION_DAYS.login_attempts_success, {
      success: true,
    }),
    deleteOlderThan(supabase, "daily_log_revisions", "edited_at", RETENTION_DAYS.daily_log_revisions),
    deleteOlderThan(supabase, "audit_logs", "changed_at", RETENTION_DAYS.audit_logs),
    deleteOlderThan(supabase, "app_messages", "created_at", RETENTION_DAYS.app_messages),
  ]);
}

async function deleteOlderThan(
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
  timeCol: string,
  days: number,
  match?: Record<string, boolean>,
): Promise<RetentionResult> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let query = supabase.from(table).delete({ count: "exact" }).lt(timeCol, cutoff);
  if (match) query = query.match(match);
  const { error, count } = await query;
  return {
    table: match ? `${table}(${Object.entries(match).map(([k, v]) => `${k}=${v}`).join(",")})` : table,
    cutoff,
    deleted: error ? null : count ?? 0,
    error: error ? error.message : null,
  };
}
