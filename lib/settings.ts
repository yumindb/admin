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
  /** 核定關是否要兩位不同的核定人都簽名(2026-07-20 拍板的雙簽制) */
  dualSign: "approval.dual_sign_enabled",
} as const;

/** 雙簽開關讀不到時的預設 — 維持 2026-07-20 拍板的雙簽 */
const DUAL_SIGN_FALLBACK = true;

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
 * 核定關是否採雙簽。
 *
 * 2026-08-04:業主要求暫時關掉(第二位核定人還沒到職),production 的設定值是
 * false。到職後在「人員管理」頁打開即可,不用改程式。
 */
export async function isDualSignEnabled(
  supabase: SupabaseClient,
): Promise<boolean> {
  const value = await readSetting(supabase, SETTING_KEYS.dualSign);
  if (value === undefined || value === null) return DUAL_SIGN_FALLBACK;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return DUAL_SIGN_FALLBACK;
}
