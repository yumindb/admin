"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";

/**
 * 結案 / 重新開啟。
 *
 * 結案是「防漏財」的最後一道閘門:未簽約項目沒報價、沒簽約就結案,
 * 追加的錢就再也不會有人想起來。所以結案前先跑 checklist,
 * 把錢跟簽核的未竟事項攤開給辦公室助理 / 老闆看 — 軟性警告,不硬擋
 * (與 GPS geofence 同哲學:硬擋只會逼人繞過)。
 */

export type CloseChecklist = {
  /** 未簽約項目總數 */
  unsignedCount: number;
  /** 其中還沒報價(沒單價)的 — 最危險,錢還沒算就要結案 */
  unquotedCount: number;
  /** 未簽約項目名稱(最多 8 筆,未報價優先) */
  unsignedNames: string[];
  /** 還在簽核流程中的日誌 */
  pendingLogCount: number;
  /** 草稿日誌(主任還沒送出) */
  draftLogCount: number;
  /** 待處理的現場回報 */
  pendingReportCount: number;
};

export type ChecklistResult =
  | { ok: true; checklist: CloseChecklist }
  | { ok: false; error: string };

export async function getCloseChecklistAction(caseId: string): Promise<ChecklistResult> {
  try {
    await requireRole(["office_staff", "owner"]);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "權限不足" };
  }
  if (!z.string().uuid().safeParse(caseId).success) {
    return { ok: false, error: "案件 ID 格式錯誤" };
  }

  const supabase = await createClient();
  const [{ data: unsigned }, { count: pendingLogs }, { count: draftLogs }, { count: pendingReports }] =
    await Promise.all([
      supabase
        .from("case_work_items")
        .select("id, name, unit_price")
        .eq("case_id", caseId)
        .eq("item_type", "unsigned"),
      supabase
        .from("daily_logs")
        .select("id", { count: "exact", head: true })
        .eq("case_id", caseId)
        .eq("status", "submitted"),
      supabase
        .from("daily_logs")
        .select("id", { count: "exact", head: true })
        .eq("case_id", caseId)
        .eq("status", "draft"),
      supabase
        .from("field_reports")
        .select("id", { count: "exact", head: true })
        .eq("case_id", caseId)
        .eq("status", "pending"),
    ]);

  const rows = (unsigned ?? []) as { id: string; name: string; unit_price: number | null }[];
  // 有單價即視為已報價(與 quote_status 的既有慣例一致)
  const unquoted = rows.filter((r) => r.unit_price === null);
  const quoted = rows.filter((r) => r.unit_price !== null);
  return {
    ok: true,
    checklist: {
      unsignedCount: rows.length,
      unquotedCount: unquoted.length,
      unsignedNames: [...unquoted, ...quoted].slice(0, 8).map((r) => r.name),
      pendingLogCount: pendingLogs ?? 0,
      draftLogCount: draftLogs ?? 0,
      pendingReportCount: pendingReports ?? 0,
    },
  };
}

// paused:2026-07 補上 — schema 一直有這個狀態(打卡選單、報表都認),
// 但沒有任何 UI 能設定。暫停中的案件不列入「案件停滯」警示。
const StatusSchema = z.object({
  caseId: z.string().uuid(),
  status: z.enum(["active", "paused", "closed"]),
});

export async function setCaseStatusAction(
  caseId: string,
  status: "active" | "paused" | "closed",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireRole(["office_staff", "owner"]);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "權限不足" };
  }
  const parsed = StatusSchema.safeParse({ caseId, status });
  if (!parsed.success) return { ok: false, error: "參數格式錯誤" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("cases")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.caseId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/cases");
  revalidatePath(`/cases/${parsed.data.caseId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
