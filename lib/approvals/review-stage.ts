import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalStage } from "@/lib/types";
import { isReviewStageEnabled } from "@/lib/settings";

/**
 * 審閱關(2026-09-09 業主拍板,取代原本的「核定雙簽」)。
 *
 * 背景:
 *   雙簽(兩位核定人都簽才 approved)是 2026-07-20 的內控構想,第二位核定人
 *   一直沒到職,production 從 2026-08-04 起就是單簽。2026-09 業主改口:
 *     1. 核定維持**一位**核定人簽完就 approved + 產 PDF
 *     2. 另外加一個角色「審閱人」— 在系統上簽核就好,**不進 PDF**
 *   所以雙簽整套拿掉,換成這個可開關的審閱關。
 *
 * 規則:
 *   - 位置:辦公室審核(audit)通過後 → 審閱(review)→ 核定(approve)
 *   - 開關在 app_settings `approval.review_stage_enabled`(人員管理頁);
 *     設定讀不到一律當「關」= 這功能上線前的三關流程
 *   - 保險:開關打開但**沒有任何啟用中的審閱人帳號** → 自動跳過這關,
 *     不然日誌會永遠卡在沒人能簽的關卡(跟以前雙簽「只有一位老闆就退回單簽」同一個教訓)
 *   - 審閱人退回 → 跟其他關一樣 rejected,主任修正後重送回 audit
 *   - 撤回核定 → 回 audit(不變),之後若審閱關開著會再經過審閱
 *   - PDF 的簽章欄與意見列**都不列** review 關(omitReviewStage)
 */

export const REVIEW_STAGE: ApprovalStage = "review";

/** 審閱關現在有沒有在跑:設定打開 + 至少一位啟用中的審閱人 */
export async function isReviewStageActive(
  supabase: SupabaseClient,
): Promise<boolean> {
  if (!(await isReviewStageEnabled(supabase))) return false;

  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "reviewer")
    .eq("is_active", true);
  // 查不到就當沒有審閱人 — 寧可少一關,也不要把日誌送進沒人能簽的關卡
  if (error || count == null) return false;
  return count > 0;
}

/** 辦公室審核通過後,日誌該進哪一關 */
export async function stageAfterAudit(
  supabase: SupabaseClient,
): Promise<"review" | "approve"> {
  return (await isReviewStageActive(supabase)) ? "review" : "approve";
}

/**
 * PDF 用:審閱關的簽名與意見一律不進 PDF(業主要求「在系統上簽核就好」)。
 * 純函式,PDF 元件與測試共用。
 */
export function omitReviewStage<T extends { stage: string }>(rows: T[]): T[] {
  return rows.filter((r) => r.stage !== REVIEW_STAGE);
}
