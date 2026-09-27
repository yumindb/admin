"use server";

import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { isMonthKey, loadWorkHours, monthRange } from "@/lib/payroll/work-hours-data";
import { buildWorkHoursXlsx } from "@/lib/excel/work-hours-report";
import type { ExcelDownloadResult } from "@/app/(app)/cases/[id]/excel-actions";

/** 工時對帳 Excel(office_staff / owner)。只有時數沒有金額,不需要薪資權限。 */
export async function exportWorkHoursXlsxAction(input: {
  month: string;
  userId?: string | null;
}): Promise<ExcelDownloadResult> {
  try {
    await requireRole(["office_staff", "owner"]);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "權限不足" };
  }
  const parsed = z
    .object({ month: z.string().refine(isMonthKey, "月份格式錯誤"), userId: z.string().uuid().nullable().optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "輸入格式錯誤" };

  const { from, to } = monthRange(parsed.data.month);
  const supabase = await createClient();
  const report = await loadWorkHours(supabase, {
    from,
    to,
    userIds: parsed.data.userId ? [parsed.data.userId] : undefined,
  });
  const buffer = buildWorkHoursXlsx({ rangeLabel: `${from} ～ ${to}`, people: report.people });
  return {
    ok: true,
    dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buffer.toString("base64")}`,
    fileName: `工時對帳_${parsed.data.month}${parsed.data.userId ? "_單人" : ""}.xlsx`,
  };
}
