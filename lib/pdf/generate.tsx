/**
 * 日誌 PDF 產生 + 上傳到 Supabase Storage。
 *
 * 設計重點：
 *   - 使用 service-role client（避免 RLS 阻擋寫 PDF / signed URL）
 *   - 抓 daily-photos / signatures 物件 → base64 data URL → 嵌進 PDF
 *   - 產 PDF buffer → 上傳到 daily-log-pdfs bucket
 *   - 寫 pdf_path 回 daily_logs row
 */
import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { createServiceClient } from "@/lib/supabase/server";
import { DailyLogPdf, type PdfData, type PdfApproval, type PdfPhoto } from "./daily-log-pdf";
import type { DailyLog, LogApproval } from "@/lib/types";
import { normalizeLogPhotos } from "@/lib/daily-log";
import {
  fetchWorkItemAncestry,
  groupWorkItemsByAncestor,
} from "@/lib/work-item-grouping";

const PDF_BUCKET = "daily-log-pdfs";
const PHOTOS_BUCKET = "daily-photos";
const SIGNATURES_BUCKET = "signatures";

/**
 * 把 storage 路徑（含或不含 bucket prefix）抓成 base64 data URL。
 * 抓不到回 null（不要讓單張壞照片擋掉整份 PDF）。
 */
async function fetchAsDataUrl(
  supabase: ReturnType<typeof createServiceClient>,
  bucket: string,
  pathOrUrl: string
): Promise<string | null> {
  // 容錯：傳進來的可能是完整 public URL（早期 daily-photos 為 public）、
  // signed URL（migration-2.10 後 daily-photos / signatures 轉 private）、
  // 或單純 storage path。signed URL 帶 ?token=...,要砍掉。
  let path = pathOrUrl;
  const m = pathOrUrl.match(
    /\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/([^?]+)/
  );
  if (m) path = decodeURIComponent(m[1]);

  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) return null;
  const arrayBuf = await data.arrayBuffer();
  const base64 = Buffer.from(arrayBuf).toString("base64");
  const ext = (path.split(".").pop() ?? "jpg").toLowerCase();
  const mime =
    ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${base64}`;
}

/**
 * 4-concurrency limiter,避免一份日誌一次拉 24+ 張照片時 Vercel 1024MB heap OOM。
 * 不裝 p-limit,手寫 worker pool 即可。
 */
async function pLimit<T, R>(
  items: T[],
  n: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function generatePdfForLog(logId: string): Promise<
  { ok: true; pdfPath: string } | { ok: false; error: string }
> {
  const supabase = createServiceClient();

  const { data: logRow, error: logErr } = await supabase
    .from("daily_logs")
    .select(
      "*, cases(name, code, company, location, expected_end), profiles!daily_logs_supervisor_id_fkey(full_name)"
    )
    .eq("id", logId)
    .maybeSingle();

  if (logErr || !logRow) return { ok: false, error: "找不到日誌或讀取失敗" };

  const log = logRow as unknown as DailyLog & {
    cases: {
      name: string;
      code: string | null;
      company: string;
      location: string | null;
      expected_end: string | null;
    } | null;
    profiles: { full_name: string } | null;
  };

  // 算當日序號（生 reportNumber 用）
  const { count: dayCount } = await supabase
    .from("daily_logs")
    .select("id", { count: "exact", head: true })
    .eq("case_id", log.case_id)
    .eq("log_date", log.log_date)
    .lte("created_at", log.created_at);

  // 撈合約內工項的詳細資料(含祖先,做大項分組用)
  const wiIds = (log.work_items ?? []).map((w) => w.work_item_id);
  const ancestry = await fetchWorkItemAncestry(supabase, wiIds);
  const groupsRaw = groupWorkItemsByAncestor(
    log.work_items ?? [],
    (w) => w.work_item_id,
    ancestry
  );
  const workItemGroupsForPdf: PdfData["workItemGroups"] = groupsRaw
    .map((g) => ({
      groupName: g.selfOnly ? null : g.groupName,
      groupTenderCode: g.selfOnly ? null : g.groupTenderCode,
      items: g.items
        .map((w) => {
          const node = ancestry.get(w.work_item_id);
          if (!node) return null;
          return {
            wi: {
              id: node.id,
              name: node.name,
              unit: node.unit,
              tenderCode: node.tender_code,
            },
            qty: w.qty,
            note: w.note,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    }))
    .filter((g) => g.items.length > 0);

  // 撈簽核紀錄 + 簽核者姓名
  const { data: approvalRows } = await supabase
    .from("log_approvals")
    .select("*")
    .eq("log_id", logId)
    .order("created_at", { ascending: true });
  const approvals = (approvalRows ?? []) as LogApproval[];
  const approverIds = Array.from(
    new Set(approvals.map((a) => a.approver_id).filter(Boolean))
  ) as string[];
  const { data: approverProfiles } = approverIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", approverIds)
    : { data: [] };
  const profileMap = new Map<string, string>();
  for (const p of approverProfiles ?? []) {
    profileMap.set(p.id as string, (p.full_name as string) ?? "—");
  }

  // 簽名圖 + 工地照片合併成同一個 4-concurrency 池,避免一次拉 24+ object 把 heap 撐爆。
  // 簽名 daily-photos / signatures 都試(早期實作有混用)。
  const approvalsForPdf: PdfApproval[] = await pLimit(approvals, 4, async (a) => {
    let signatureDataUrl: string | null = null;
    if (a.signature_url) {
      signatureDataUrl =
        (await fetchAsDataUrl(supabase, SIGNATURES_BUCKET, a.signature_url)) ??
        (await fetchAsDataUrl(supabase, PHOTOS_BUCKET, a.signature_url));
    }
    return {
      ...a,
      approverName: a.approver_id ? profileMap.get(a.approver_id) ?? null : null,
      signatureDataUrl,
    };
  });

  // 工地照片 → base64 data URL。caption 取使用者填的說明,沒填則用「照片 N」。
  const rawPhotos = normalizeLogPhotos(log.photos);
  const photoResults = await pLimit<typeof rawPhotos[number], PdfPhoto | null>(
    rawPhotos,
    4,
    async (p, idx) => {
      const dataUrl = await fetchAsDataUrl(supabase, PHOTOS_BUCKET, p.path);
      if (!dataUrl) return null;
      return { dataUrl, caption: p.caption.trim() || `照片 ${idx + 1}` };
    }
  );
  const photos: PdfPhoto[] = photoResults.filter(
    (x): x is PdfPhoto => x !== null
  );

  const data: PdfData = {
    log,
    case: {
      name: log.cases?.name ?? "(已刪除案件)",
      code: log.cases?.code ?? null,
      company: log.cases?.company ?? "—",
      location: log.cases?.location ?? null,
      expectedEnd: log.cases?.expected_end ?? null,
    },
    daySeq: dayCount ?? 1,
    supervisorName: log.profiles?.full_name ?? "—",
    workItemGroups: workItemGroupsForPdf,
    extraItems: log.extra_items ?? [],
    unsignedItems: log.unsigned_items ?? [],
    photos,
    approvals: approvalsForPdf,
  };

  // 產 PDF buffer
  const buffer = await renderToBuffer(<DailyLogPdf data={data} />);

  // 上傳
  const pdfPath = `${log.case_id}/${logId}.pdf`;
  const { error: upErr } = await supabase.storage
    .from(PDF_BUCKET)
    .upload(pdfPath, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upErr) return { ok: false, error: "PDF 上傳失敗：" + upErr.message };

  // 寫回 daily_logs.pdf_path
  const { error: updErr } = await supabase
    .from("daily_logs")
    .update({ pdf_path: pdfPath })
    .eq("id", logId);
  if (updErr) return { ok: false, error: "寫入 pdf_path 失敗：" + updErr.message };

  return { ok: true, pdfPath };
}
