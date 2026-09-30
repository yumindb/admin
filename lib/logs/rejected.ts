import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 「你有 N 份日誌被退回」提示條(/logs 最上面)的資料。
 *
 * 2026-09-30:主任都沒綁 LINE,退件只靠站內消息鈴鐺 — 有主任從沒點開過,
 * 被老闆退回的日誌放了一週多沒人改。列表上只有 10px 的「已退回」小標,
 * 預設又是「所有日誌」,自己的退件混在全公司裡。
 */

export type MyRejectedLog = {
  id: string;
  logDate: string;
  caseName: string;
  /** 最後一次「有寫內容」的退回原因;都沒寫則 null */
  reason: string | null;
};

const MAX_ROWS = 20;

/**
 * 退回原因有沒有實際內容。助理曾經為了把日誌打回給主任,
 * 「重送再退回」只打一個「.」— 那種原因要跳過,改顯示前一次老闆寫的。
 */
export function isMeaningfulReason(comment: string | null | undefined): boolean {
  if (!comment) return false;
  return /[\p{L}\p{N}]/u.test(comment);
}

/**
 * 從同一份日誌的退回紀錄(新 → 舊)挑要顯示的原因:
 * 最新一筆有內容的;全部都沒內容就 null。
 */
export function pickRejectReason(
  rejectionsNewestFirst: { comment: string | null }[],
): string | null {
  const hit = rejectionsNewestFirst.find((r) => isMeaningfulReason(r.comment));
  return hit?.comment?.trim() ?? null;
}

/**
 * 目前使用者自己填的(含代理填寫)、狀態為退回的日誌,舊的在前(越久越該先改)。
 * 最多回 MAX_ROWS 份;`total` 是實際總數。
 */
export async function loadMyRejectedLogs(
  supabase: SupabaseClient,
  profileId: string,
): Promise<{ logs: MyRejectedLog[]; total: number }> {
  const { data: logs, count } = await supabase
    .from("daily_logs")
    .select("id, log_date, cases(name)", { count: "exact" })
    .eq("supervisor_id", profileId)
    .eq("status", "rejected")
    .order("log_date", { ascending: true })
    .limit(MAX_ROWS);
  const rows = (logs ?? []) as unknown as {
    id: string;
    log_date: string;
    cases: { name: string } | null;
  }[];
  if (rows.length === 0) return { logs: [], total: 0 };

  const { data: rejections } = await supabase
    .from("log_approvals")
    .select("log_id, comment, created_at")
    .in(
      "log_id",
      rows.map((r) => r.id),
    )
    .eq("decision", "rejected")
    .order("created_at", { ascending: false });
  const byLog = new Map<string, { comment: string | null }[]>();
  for (const r of (rejections ?? []) as { log_id: string; comment: string | null }[]) {
    const list = byLog.get(r.log_id) ?? [];
    list.push(r);
    byLog.set(r.log_id, list);
  }

  return {
    logs: rows.map((r) => ({
      id: r.id,
      logDate: r.log_date,
      caseName: r.cases?.name ?? "（已刪除案件）",
      reason: pickRejectReason(byLog.get(r.id) ?? []),
    })),
    total: Math.max(count ?? rows.length, rows.length),
  };
}
