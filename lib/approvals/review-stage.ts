import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalStage } from "@/lib/types";

/**
 * 審閱人「加簽」(2026-09-13 業主定案,取代 09-09 那版的「審閱關」)。
 *
 * 業主原話:「這個審閱動作跟流程無關,辦公室簽完後隨時可隨意加簽,
 * 然後只出現在系統上,都不用出現在 PDF。」
 *
 * 所以:
 *   - **不是關卡**。日誌照原本三關走(填表 → 審核 → 核定),審閱人簽不簽、
 *     什麼時候簽,都不影響狀態、不擋核定、不發 LINE。
 *   - 什麼時候可以加簽:辦公室審核通過之後 — 即日誌停在核定關(submitted + approve)
 *     或已核定(approved)。退回 / 草稿 / 還在審核關的不行。
 *   - 加簽 = 在 log_approvals 寫一筆 stage='review'、decision='approved' 的紀錄
 *     (簽名 + 選填意見),daily_logs 完全不動。同一輪只能加簽一次
 *     (退回重送 / 撤回核定後是新的一輪,可以再簽)。
 *   - 有寫意見才發站內消息(跟其他關一致);沒意見就只是一筆紀錄。
 *   - PDF 的簽章欄與意見列**都不列** review 關(omitReviewStage)。
 *
 * `review` 這個 stage 值原本是「主任複核」,production 從沒用過,直接借用。
 */

export const REVIEW_STAGE: ApprovalStage = "review";

/** 這份日誌現在能不能被加簽:辦公室審核已通過(停在核定關,或已核定) */
export function canEndorseLog(log: {
  status: string;
  current_stage: string | null;
}): boolean {
  if (log.status === "approved") return true;
  return log.status === "submitted" && log.current_stage === "approve";
}

/**
 * 這一輪 userId 已加簽過的 log id(待加簽清單 / 詳情頁按鈕用來過濾)。
 * 「這一輪」= log_approvals.created_at >= daily_logs.submitted_at;
 * submitted_at 缺值時保守當作已簽,寧可少顯示也不要讓人重複簽。
 */
export async function findEndorsedLogIds(
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
    .eq("stage", REVIEW_STAGE)
    .eq("decision", "approved")
    .eq("approver_id", userId)
    .in("log_id", ids);

  const submittedAtById = new Map(logs.map((l) => [l.id, l.submitted_at]));
  for (const row of (data ?? []) as { log_id: string; created_at: string }[]) {
    const submittedAt = submittedAtById.get(row.log_id);
    if (!submittedAt || row.created_at >= submittedAt) signed.add(row.log_id);
  }
  return signed;
}

/**
 * PDF 用:審閱人的簽名與意見一律不進 PDF。純函式,PDF 元件與測試共用。
 */
export function omitReviewStage<T extends { stage: string }>(rows: T[]): T[] {
  return rows.filter((r) => r.stage !== REVIEW_STAGE);
}
