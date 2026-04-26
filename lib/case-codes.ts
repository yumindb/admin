/**
 * 案件編號自動產生 — 格式 `YM-YYYY-NNN`，每年從 001 起跳。
 *
 * 邏輯：撈當年度所有 `YM-{year}-%` 編號，取最大 NNN +1。
 * 若資料庫查詢失敗或無資料 → 回傳 `YM-{year}-001`。
 *
 * 注意：兩位 office 同時開新案理論上會撞號，POC 階段先不加 unique constraint，
 * 預填欄位本身就降低撞號機率;之後可在 cases.code 加 unique index + 重試 1-2 次。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getNextCaseCode(
  supabase: SupabaseClient,
  year: number = new Date().getFullYear()
): Promise<string> {
  const prefix = `YM-${year}-`;
  const { data, error } = await supabase
    .from("cases")
    .select("code")
    .like("code", `${prefix}%`);
  if (error) return `${prefix}001`;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let maxN = 0;
  for (const row of data ?? []) {
    const m = re.exec((row.code as string | null) ?? "");
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
  }
  return `${prefix}${String(maxN + 1).padStart(3, "0")}`;
}
