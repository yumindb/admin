/**
 * 跨案工項累計 Excel 產生器。
 *
 * 一張 sheet,每列 = 一個工項(限 item / spec)。欄位:
 *   公司 / 案件名 / 案件編號 / 編碼 / 項目 / 單位 / 契約量 / 累計完成量 / 累計完成 %
 *
 * 用於 /reports/work-items 頁的「下載 Excel」按鈕。資料量可能上千筆,
 * 但欄位精簡所以 buffer 不至於太大;呼叫端應帶相同篩選條件後再傳入。
 */
import * as XLSX from "xlsx";
import type { CaseWorkItem, Case } from "@/lib/types";

export type CrossCaseSummaryRow = {
  caseId: string;
  caseName: string;
  caseCode: string | null;
  caseCompany: string;
  workItemId: string;
  workItemCode: string | null;
  workItemName: string;
  workItemUnit: string | null;
  contractQty: number | null;
  doneQty: number;
  donePct: number | null;
};

export function buildCrossCaseSummaryXlsx(
  rows: CrossCaseSummaryRow[],
): Buffer {
  const out: (string | number)[][] = [];
  out.push([
    `跨案工項累計 — 匯出 ${new Date().toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}`,
  ]);
  out.push([]);
  out.push([
    "公司",
    "案件名",
    "案件編號",
    "編碼",
    "項目",
    "單位",
    "契約量",
    "累計完成量",
    "累計完成 %",
  ]);

  for (const r of rows) {
    out.push([
      r.caseCompany ?? "",
      r.caseName,
      r.caseCode ?? "",
      r.workItemCode ?? "",
      r.workItemName,
      r.workItemUnit ?? "",
      r.contractQty ?? "",
      r.doneQty,
      r.donePct !== null ? r.donePct : "",
    ]);
  }

  if (rows.length === 0) {
    out.push(["", "(無資料)", "", "", "", "", "", "", ""]);
  }

  const ws = XLSX.utils.aoa_to_sheet(out);
  ws["!cols"] = [
    { wch: 10 }, // 公司
    { wch: 24 }, // 案件名
    { wch: 12 }, // 編號
    { wch: 14 }, // 編碼
    { wch: 28 }, // 項目
    { wch: 8 },  // 單位
    { wch: 12 }, // 契約量
    { wch: 12 }, // 累計完成量
    { wch: 12 }, // %
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "跨案累計");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buf;
}

/**
 * 把多個 case + 對應 work_items + log_work_items 算成 CrossCaseSummaryRow[]。
 * 給 cross-case 跟 /reports/work-items 共用,讓 server side 一次算完。
 */
export function computeCrossCaseSummaryRows(input: {
  cases: Case[];
  workItems: CaseWorkItem[];
  /** 每個 daily_logs 的 work_items 陣列。case_id + qty + qty_mode + work_item_id */
  logWorkItems: {
    case_id: string;
    work_item_id: string;
    qty: number;
    qty_mode?: "absolute" | "percent";
  }[];
}): CrossCaseSummaryRow[] {
  const { cases, workItems, logWorkItems } = input;
  const caseById = new Map<string, Case>();
  for (const c of cases) caseById.set(c.id, c);

  const itemById = new Map<string, CaseWorkItem>();
  for (const it of workItems) itemById.set(it.id, it);

  // 累計完成量(per work_item)
  const doneByItem = new Map<string, number>();
  for (const w of logWorkItems) {
    if (!w || typeof w.qty !== "number" || !Number.isFinite(w.qty)) continue;
    const meta = itemById.get(w.work_item_id);
    const total = meta?.quantity ?? null;
    const inc =
      w.qty_mode === "percent" ? (total ?? 0) * w.qty : w.qty;
    doneByItem.set(
      w.work_item_id,
      (doneByItem.get(w.work_item_id) ?? 0) + inc,
    );
  }

  const out: CrossCaseSummaryRow[] = [];
  // 排序:case_name → sort_path
  const sortedItems = [...workItems].sort((a, b) => {
    const ca = caseById.get(a.case_id);
    const cb = caseById.get(b.case_id);
    const cmpName = (ca?.name ?? "").localeCompare(cb?.name ?? "");
    if (cmpName !== 0) return cmpName;
    return (a.sort_path ?? "").localeCompare(b.sort_path ?? "");
  });

  for (const it of sortedItems) {
    if (it.item_type !== "item" && it.item_type !== "spec") continue;
    if (it.skipped) continue;
    const c = caseById.get(it.case_id);
    if (!c) continue;
    const done = doneByItem.get(it.id) ?? 0;
    const total = it.quantity;
    const pct =
      total !== null && total !== undefined && total > 0
        ? Math.round((done / total) * 1000) / 10
        : null;
    out.push({
      caseId: c.id,
      caseName: c.name,
      caseCode: c.code,
      caseCompany: c.company,
      workItemId: it.id,
      workItemCode: it.tender_code,
      workItemName: it.name,
      workItemUnit: it.unit,
      contractQty: it.quantity,
      doneQty: done,
      donePct: pct,
    });
  }

  return out;
}
