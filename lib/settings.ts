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

/**
 * 簽核相關的設定都拿掉了(雙簽開關 08-04 → 09-09,審閱關開關 09-09 → 09-13)。
 * 2026-09 起這張表放**薪資規則**(`payroll.*`,migration-2.40),key 與 schema 集中在
 * `lib/payroll/settings.ts`,這裡只留讀取 helper。
 */
export const SETTING_KEYS = {} as const;

/** 一次讀多個 key(單一查詢)。表不存在 / 查詢失敗 → 空 Map,呼叫端自行套預設 */
export async function readSettings(
  supabase: SupabaseClient,
  keys: readonly string[],
): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  if (keys.length === 0) return out;
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", [...keys]);
  if (error) {
    const missing =
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      (error.message ?? "").includes("app_settings");
    if (!missing) console.error("[settings] 讀多筆設定失敗:", error.message);
    return out;
  }
  for (const row of data ?? []) {
    out.set(row.key as string, row.value);
  }
  return out;
}

export async function readSetting(
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

