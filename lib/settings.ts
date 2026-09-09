import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 系統設定(app_settings,migration-2.34)。
 *
 * key-value + jsonb,讀取所有登入者都可以,寫入只走 service-role
 * (server action 內先 requireRole)。
 *
 * 降級原則:**設定讀不到就回「原本的行為」**。migration 沒跑、查詢失敗、
 * 那一列被刪掉 — 任何一種情況都不該讓簽核流程變成另一種規則,
 * 只會維持這個功能上線前的樣子。
 */

export const SETTING_KEYS = {
  /** 審閱關要不要跑(2026-09-09 取代雙簽;審閱人在系統上簽核、不進 PDF) */
  reviewStage: "approval.review_stage_enabled",
} as const;

/** 審閱關開關讀不到時的預設 — 關(= 這一關出現之前的三關流程) */
const REVIEW_STAGE_FALLBACK = false;

async function readSetting(
  supabase: SupabaseClient,
  key: string,
): Promise<unknown | undefined> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) {
    // 表不存在(migration 還沒跑)是預期中的情況,不吵;其他錯誤留一行方便查
    const missing =
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      (error.message ?? "").includes("app_settings");
    if (!missing) console.error(`[settings] 讀 ${key} 失敗:`, error.message);
    return undefined;
  }
  return data?.value;
}

/**
 * 審閱關開關(2026-09-09 業主拍板,取代原本的核定雙簽)。
 *
 * true = 辦公室審核通過後先給審閱人簽,再給核定人;false = 審核後直接核定。
 * 開關只是「要不要這關」;實際會不會跑還要看有沒有啟用中的審閱人 —
 * 見 lib/approvals/review-stage.ts 的 isReviewStageActive()。
 * 在「人員管理」頁切換,不用改程式。
 */
export async function isReviewStageEnabled(
  supabase: SupabaseClient,
): Promise<boolean> {
  const value = await readSetting(supabase, SETTING_KEYS.reviewStage);
  if (value === undefined || value === null) return REVIEW_STAGE_FALLBACK;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return REVIEW_STAGE_FALLBACK;
}
