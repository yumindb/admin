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
 * ⚠ login_attempts 的時間欄位是 attempted_at(不是 created_at)—
 *   2026-07 前的版本用錯欄位,清理其實一直沒生效,已修正。
 */

export const RETENTION_DAYS = {
  login_attempts_failed: 30,
  login_attempts_success: 365,
  daily_log_revisions: 365,
  audit_logs: 365,
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
    deleteOlderThan(supabase, "daily_log_revisions", "created_at", RETENTION_DAYS.daily_log_revisions),
    deleteOlderThan(supabase, "audit_logs", "changed_at", RETENTION_DAYS.audit_logs),
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
