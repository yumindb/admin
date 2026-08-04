import type { SupabaseClient } from "@supabase/supabase-js";
import { isDualSignEnabled } from "@/lib/settings";

/**
 * 核定關雙簽名(2026-07-20 業主拍板;2026-08-04 起可在「人員管理」頁關掉)。
 *
 * 規則(雙簽開啟時):
 *   - 核定(approve)關要「兩位不同的 owner」都簽名才算完成 → status='approved'
 *   - 不限順序,誰先簽都可以;同一個人在同一輪不能簽兩次
 *   - 「同一輪」= 本次送出之後。退回重送會重新計算(舊輪的簽名不算數),
 *     判斷基準:log_approvals.created_at >= daily_logs.submitted_at
 *
 * 雙簽關閉時(2026-08-04 的現況,第二位核定人還沒到職):
 *   一位核定人簽完就直接 approved + 產 PDF,其餘流程完全一樣。
 *
 * 計數存在 daily_logs.approve_signatures(migration-2.29),
 * 用條件式 UPDATE 序列化兩人同時簽的情況 — 見 approveStageAction。
 */

export const REQUIRED_APPROVE_SIGNATURES = 2;

/**
 * 這個系統實際需要幾位核定簽名。
 *
 * 三層:
 *   1. 設定關掉雙簽(app_settings,migration-2.34)→ 1
 *   2. 保險:**啟用中的**老闆帳號只有一位時要求兩簽 = 日誌永遠卡在核定關。
 *      所以取 min(2, 啟用中的 owner 帳號數)。
 *      ⚠ 2026-08-04 修:原本沒有濾 is_active,停用的離職老闆也被算成「還有人可以簽」,
 *      日誌一樣會卡死。
 *   3. 其他情況 → 2
 */
export async function requiredApproveSignatures(
  supabase: SupabaseClient,
): Promise<number> {
  if (!(await isDualSignEnabled(supabase))) return 1;

  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "owner")
    .eq("is_active", true);
  if (error || count == null) return REQUIRED_APPROVE_SIGNATURES;
  return Math.min(REQUIRED_APPROVE_SIGNATURES, Math.max(1, count));
}

/** 這一輪已在核定關簽過名的 log id(用於待辦清單過濾:已簽的人不該再看到) */
export async function findApproveSignedLogIds(
  supabase: SupabaseClient,
  userId: string,
  logs: { id: string; submitted_at: string | null }[],
): Promise<Set<string>> {
  const signed = new Set<string>();
  const ids = logs.map((l) => l.id);
  if (ids.length === 0) return signed;

  const { data } = await supabase
    .from("log_approvals")
    .select("log_id, created_at")
    .eq("stage", "approve")
    .eq("decision", "approved")
    .eq("approver_id", userId)
    .in("log_id", ids);

  const submittedAtById = new Map(logs.map((l) => [l.id, l.submitted_at]));
  for (const row of (data ?? []) as { log_id: string; created_at: string }[]) {
    const submittedAt = submittedAtById.get(row.log_id);
    // submitted_at 缺值(理論上不會)→ 保守當作本輪,寧可少顯示也不要重複簽
    if (!submittedAt || row.created_at >= submittedAt) signed.add(row.log_id);
  }
  return signed;
}

/** 本輪核定關的簽名紀錄(排除 / 只取自己,由呼叫端決定) */
export async function loadApproveSignersThisRound(
  supabase: SupabaseClient,
  logId: string,
  submittedAt: string | null,
): Promise<{ approverId: string | null; createdAt: string }[]> {
  const { data } = await supabase
    .from("log_approvals")
    .select("approver_id, created_at")
    .eq("log_id", logId)
    .eq("stage", "approve")
    .eq("decision", "approved")
    .order("created_at", { ascending: true });

  return ((data ?? []) as { approver_id: string | null; created_at: string }[])
    .filter((r) => !submittedAt || r.created_at >= submittedAt)
    .map((r) => ({ approverId: r.approver_id, createdAt: r.created_at }));
}
