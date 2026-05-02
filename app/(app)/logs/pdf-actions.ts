"use server";

import { revalidatePath } from "next/cache";
import JSZip from "jszip";
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
 * 補產 PDF — 在「核定通過但 pdf_path 還是空」的情況下手動觸發。
 */
export async function regeneratePdfAction(
  logId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole([...PDF_VIEWERS]);
  const supabase = await createClient();

  const { data: log } = await supabase
    .from("daily_logs")
    .select("status")
    .eq("id", logId)
    .maybeSingle();
  if (!log) return { ok: false, error: "找不到日誌" };
  if (log.status !== "approved")
    return { ok: false, error: "尚未核定,無法產 PDF" };

  const res = await generatePdfForLog(logId);
  if (!res.ok) return res;
  revalidatePath(`/logs/${logId}`);
  revalidatePath("/logs");
  return { ok: true };
}

/**
 * 批次下載：把多份 PDF 包成一個 zip 回傳 base64。
 *   - 沒產過的 PDF 會即時補產
 *   - 非 approved 的日誌跳過
 *   - 回傳 base64 + 檔名,client 自己組成 data URL 觸發下載
 */
export async function bulkDownloadPdfsAction(logIds: string[]): Promise<
  | { ok: true; zipBase64: string; fileName: string; included: number; skipped: number }
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
  const zip = new JSZip();
  let included = 0;
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
    const { data: blob, error } = await service.storage
      .from("daily-log-pdfs")
      .download(pdfPath);
    if (error || !blob) {
      skipped++;
      continue;
    }
    const arr = await blob.arrayBuffer();
    const caseInfo = log.cases as unknown as { code: string | null; name: string } | null;
    const caseCode = caseInfo?.code ?? "YM";
    zip.file(`${caseCode}_${log.log_date}_${(log.id as string).slice(0, 6)}.pdf`, arr);
    included++;
  }

  if (included === 0) {
    return { ok: false, error: "選的日誌沒有可下載的 PDF（可能還沒核定）" };
  }

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return {
    ok: true,
    zipBase64: buf.toString("base64"),
    fileName: `yumin-logs-${today}.zip`,
    included,
    skipped,
  };
}
