import type { createServiceClient } from "@/lib/supabase/server";

/**
 * 三張 audit / log 表的 retention 清理工具,
 * 給 cron 呼叫(目前掛在 recheck-stuck-pdfs 路由,
 * Hobby plan 只能 2 個 cron,故併入既有 nightly 工作)。
 *
 * 為什麼有 retention:
 *   - login_attempts: 失敗紀錄留太久變肥 + 沒人會回查超過一個月前的
 *   - daily_log_revisions: 日誌編輯軌跡,留 1 年足夠覆蓋稅務 / 爭議
 *   - audit_logs: 帳號 / 工項 / 合約變更,留 1 年同上
 *
 * 為什麼用 service-role:
 *   audit_logs 沒開 DELETE policy(一般使用者不可竄改)。
 *   cron 走 service-role 是唯一能清的路徑。
 */

export const RETENTION_DAYS = {
  login_attempts: 30,
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
    deleteOlderThan(supabase, "login_attempts", "created_at", RETENTION_DAYS.login_attempts),
    deleteOlderThan(supabase, "daily_log_revisions", "created_at", RETENTION_DAYS.daily_log_revisions),
    deleteOlderThan(supabase, "audit_logs", "changed_at", RETENTION_DAYS.audit_logs),
  ]);
}

async function deleteOlderThan(
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
  timeCol: string,
  days: number,
): Promise<RetentionResult> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await supabase
    .from(table)
    .delete({ count: "exact" })
    .lt(timeCol, cutoff);
  return {
    table,
    cutoff,
    deleted: error ? null : count ?? 0,
    error: error ? error.message : null,
  };
}
