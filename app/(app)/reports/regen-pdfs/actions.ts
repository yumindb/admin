"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { generatePdfForLog } from "@/lib/pdf/generate";
import { fetchAllRows } from "@/lib/db/fetch-all";

/**
 * PDF 批次重產(2026-07-20:簽名被壓扁的 bug 修正後,把舊件重產一遍)。
 *
 * 設計:client 先拿清單,再「一次一份」逐筆呼叫重產 —
 * Vercel serverless 有執行時間上限,一口氣跑幾十份會 timeout;
 * 逐筆走還能給進度條 + 單筆失敗不影響其他。
 * generatePdfForLog 上傳是 upsert、路徑固定 {caseId}/{logId}.pdf,重跑冪等。
 */

export async function listRegenTargetsAction(): Promise<
  | {
      ok: true;
      targets: { id: string; logDate: string; caseName: string }[];
    }
  | { ok: false; error: string }
> {
  await requireRole(["office_staff", "owner"]);

  const supabase = createServiceClient();
  const { data, error } = await fetchAllRows((from, to) =>
    supabase
      .from("daily_logs")
      .select("id, log_date, pdf_path, cases(name)")
      .eq("status", "approved")
      .order("log_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) return { ok: false, error: "讀取日誌清單失敗" };

  const targets = (data ?? []).map((r) => {
    const row = r as unknown as {
      id: string;
      log_date: string;
      cases: { name: string } | null;
    };
    return {
      id: row.id,
      logDate: row.log_date,
      caseName: row.cases?.name ?? "（已刪除案件）",
    };
  });
  return { ok: true, targets };
}

export async function regenerateOnePdfAction(
  logId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(["office_staff", "owner"]);
  if (typeof logId !== "string" || !logId) {
    return { ok: false, error: "缺少 logId" };
  }

  // 只重產已核定的(其他狀態本來就沒有 PDF)
  const supabase = createServiceClient();
  const { data: log } = await supabase
    .from("daily_logs")
    .select("id, status")
    .eq("id", logId)
    .maybeSingle();
  if (!log) return { ok: false, error: "找不到日誌" };
  if (log.status !== "approved") {
    return { ok: false, error: "尚未核定，跳過" };
  }

  const res = await generatePdfForLog(logId);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true };
}
