"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { generatePdfForLog } from "@/lib/pdf/generate";

const PDF_VIEWERS = ["site_supervisor", "office_staff", "owner"] as const;

/**
 * 取得該日誌 PDF 的 signed URL(60 秒有效,給瀏覽器下載用)。
 * 沒產過 → 即時補產。
 */
export async function getPdfDownloadUrlAction(
  logId: string
): Promise<{ ok: true; url: string; fileName: string } | { ok: false; error: string }> {
  await requireRole([...PDF_VIEWERS]);
  const supabase = await createClient();

  const { data: log } = await supabase
    .from("daily_logs")
    .select("id, status, pdf_path, log_date, cases(code, name)")
    .eq("id", logId)
    .maybeSingle();
  if (!log) return { ok: false, error: "找不到日誌" };

  let pdfPath = log.pdf_path as string | null;
  if (!pdfPath) {
    if (log.status !== "approved") {
      return { ok: false, error: "日誌尚未核定通過,還沒有 PDF。" };
    }
    const res = await generatePdfForLog(logId);
    if (!res.ok) return { ok: false, error: res.error };
    pdfPath = res.pdfPath;
  }

  const service = createServiceClient();
  const { data: signed, error } = await service.storage
    .from("daily-log-pdfs")
    .createSignedUrl(pdfPath, 60);
  if (error || !signed)
    return { ok: false, error: "產 signed URL 失敗：" + error?.message };

  const caseInfo = log.cases as unknown as { code: string | null; name: string } | null;
  const caseCode = caseInfo?.code ?? "YM";
  const fileName = `${caseCode}_${log.log_date}.pdf`;
  return { ok: true, url: signed.signedUrl, fileName };
}

/**
 * 補產 PDF — 在「核定通過但 pdf_path 還是空」或「pdf_status='failed'」時手動觸發。
 * 同步翻 pdf_status: generating → done / failed,讓 UI 透明。
 */
export async function regeneratePdfAction(
  logId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole([...PDF_VIEWERS]);
  const supabase = await createClient();
  const service = createServiceClient();

  const { data: log } = await supabase
    .from("daily_logs")
    .select("status")
    .eq("id", logId)
    .maybeSingle();
  if (!log) return { ok: false, error: "找不到日誌" };
  if (log.status !== "approved")
    return { ok: false, error: "尚未核定,無法產 PDF" };

  // 翻 generating(用 service-role,避免 supervisor 自己重產被 RLS 擋)
  await service
    .from("daily_logs")
    .update({ pdf_status: "generating", pdf_error: null })
    .eq("id", logId);

  const res = await generatePdfForLog(logId);
  if (!res.ok) {
    await service
      .from("daily_logs")
      .update({ pdf_status: "failed", pdf_error: res.error })
      .eq("id", logId);
    return res;
  }
  await service
    .from("daily_logs")
    .update({ pdf_status: "done", pdf_error: null })
    .eq("id", logId);
  revalidatePath(`/logs/${logId}`);
  revalidatePath("/logs");
  return { ok: true };
}

/**
 * 批次下載:回傳每份 PDF 的 signed URL list,client 端用 JSZip 在瀏覽器組 zip。
 *
 * 為什麼不在 server-side 包 zip:
 *   100 份 × 平均 2MB → 200MB base64 → 270MB string → 超 Vercel 4MB action response 上限。
 *   改成 server 只回 signed URL(每筆 ~200 byte),client fetch + zip,heap 壓在瀏覽器。
 *
 * 注意:
 *   - 沒產過 PDF 的 approved log 即時補產(在 server-side,因為 generatePdfForLog 用 service-role)
 *   - 非 approved 的日誌跳過
 *   - signed URL TTL 5 min(client zip 100 份照片可能要時間)
 */
export type BulkPdfItem = {
  logId: string;
  fileName: string;
  signedUrl: string;
};
export async function bulkDownloadPdfsAction(logIds: string[]): Promise<
  | {
      ok: true;
      items: BulkPdfItem[];
      zipFileName: string;
      included: number;
      skipped: number;
    }
  | { ok: false; error: string }
> {
  await requireRole([...PDF_VIEWERS]);

  if (logIds.length === 0) return { ok: false, error: "未選任何日誌" };
  if (logIds.length > 100) return { ok: false, error: "一次最多 100 份" };

  const supabase = await createClient();

  const { data: logs } = await supabase
    .from("daily_logs")
    .select("id, status, pdf_path, log_date, cases(code, name)")
    .in("id", logIds);
  if (!logs) return { ok: false, error: "讀取日誌失敗" };

  const service = createServiceClient();
  const items: BulkPdfItem[] = [];
  let skipped = 0;

  for (const log of logs) {
    if (log.status !== "approved") {
      skipped++;
      continue;
    }
    let pdfPath = log.pdf_path as string | null;
    if (!pdfPath) {
      const res = await generatePdfForLog(log.id as string);
      if (!res.ok) {
        skipped++;
        continue;
      }
      pdfPath = res.pdfPath;
    }
    const { data: signed, error } = await service.storage
      .from("daily-log-pdfs")
      .createSignedUrl(pdfPath, 300);
    if (error || !signed) {
      skipped++;
      continue;
    }
    const caseInfo = log.cases as unknown as { code: string | null; name: string } | null;
    const caseCode = caseInfo?.code ?? "YM";
    items.push({
      logId: log.id as string,
      fileName: `${caseCode}_${log.log_date}_${(log.id as string).slice(0, 6)}.pdf`,
      signedUrl: signed.signedUrl,
    });
  }

  if (items.length === 0) {
    return { ok: false, error: "選的日誌沒有可下載的 PDF（可能還沒核定）" };
  }

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return {
    ok: true,
    items,
    zipFileName: `yumin-logs-${today}.zip`,
    included: items.length,
    skipped,
  };
}
