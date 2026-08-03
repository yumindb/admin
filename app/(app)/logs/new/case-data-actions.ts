"use server";

import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/require-role";
import { loadCaseFormData, type CaseFormData } from "@/lib/logs/case-form-data";

/**
 * 換案件時補抓該案的工項與累計。
 *
 * 表單只帶「一開始選中的那一案」進來(見 lib/logs/case-form-data.ts 的說明),
 * 主任在 picker 換案時走這支拿新的一案。回傳形狀跟 server 首次渲染時完全一樣,
 * client 直接 merge 進同一組 map。
 */
export async function loadCaseFormDataAction(
  caseId: string,
  excludeLogId?: string,
): Promise<
  { ok: true; data: CaseFormData } | { ok: false; error: string }
> {
  if (!caseId) return { ok: false, error: "缺少案件 id" };
  try {
    // 讀取層 RLS 本來就擋越權(daily_logs / case_work_items 都是登入者可讀),
    // 這裡只要確認是登入中且未被停用的帳號。
    await getActor();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const supabase = await createClient();
  const data = await loadCaseFormData(supabase, caseId, excludeLogId);
  return { ok: true, data };
}
