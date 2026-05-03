/**
 * 單案「月報」Excel 產生器。
 *
 * 內容(三個 sheet):
 *   1. 工項彙總 — 當月所有日誌的 work_items 加總
 *   2. 合約外項目 — extra_items
 *   3. 未簽約項目 — unsigned_items
 *
 * 取值:
 *   - 只取 status in (submitted, approved) 的日誌
 *   - 月份篩選依 log_date 落在 [year-month-01, 月底] 內(台灣時區)
 */
import * as XLSX from "xlsx";
import type {
  CaseWorkItem,
  DailyLog,
  DailyLogWorkItem,
  DailyLogExtraItem,
  DailyLogUnsignedItem,
} from "@/lib/types";

export type CaseMonthlyReportInput = {
  caseName: string;
  caseCode: string | null;
  year: number;
  month: number; // 1-12
  workItems: CaseWorkItem[];
  /** 當月已 submitted / approved 日誌(全欄位) */
  logs: Pick<
    DailyLog,
    | "id"
    | "log_date"
    | "work_items"
    | "extra_items"
    | "unsigned_items"
  >[];
};

export function buildCaseMonthlyReportXlsx(
  input: CaseMonthlyReportInput,
): Buffer {
  const { caseName, caseCode, year, month, workItems, logs } = input;
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  const sheetName = `月報-${ym}`;

  const itemMeta = new Map<string, CaseWorkItem>();
  for (const it of workItems) itemMeta.set(it.id, it);

  // ---- Sheet 1:工項彙總 ----
  const wiRows: (string | number)[][] = [];
  wiRows.push([
    `案件:${caseName}${caseCode ? `（${caseCode}）` : ""}`,
  ]);
  wiRows.push([`月份:${ym}`]);
  wiRows.push([]);
  wiRows.push([
    "編碼",
    "項目",
    "單位",
    "本月完成量",
    "契約量",
    "本月完成 %",
  ]);

  // 累計每個工項的本月完成量
  const monthlyDone = new Map<string, number>();
  for (const log of logs) {
    for (const w of (log.work_items ?? []) as DailyLogWorkItem[]) {
      if (!w || typeof w.qty !== "number" || !Number.isFinite(w.qty)) continue;
      const meta = itemMeta.get(w.work_item_id);
      const total = meta?.quantity ?? null;
      const inc =
        w.qty_mode === "percent" ? (total ?? 0) * w.qty : w.qty;
      monthlyDone.set(
        w.work_item_id,
        (monthlyDone.get(w.work_item_id) ?? 0) + inc,
      );
    }
  }

  // 排序:依 sort_path
  const sorted = [...workItems].sort((a, b) =>
    (a.sort_path ?? "").localeCompare(b.sort_path ?? ""),
  );

  // Sheet 1 只列「合約內」(section/item/spec/manual)的工項。extra/unsigned 走自己的 sheet。
  for (const it of sorted) {
    if (it.item_type === "extra" || it.item_type === "unsigned") continue;
    const done = monthlyDone.get(it.id);
    if (!done) continue;  // 月報只列「本月有動」的工項
    const total = it.quantity;
    const pct =
      total !== null && total !== undefined && total > 0
        ? Math.round((done / total) * 1000) / 10
        : null;
    wiRows.push([
      it.tender_code ?? "",
      it.name,
      it.unit ?? "",
      done,
      it.quantity ?? "",
      pct !== null ? pct : "",
    ]);
  }
  if (wiRows.length === 4) {
    wiRows.push(["", "(本月無工項記錄)", "", "", "", ""]);
  }

  const wsWi = XLSX.utils.aoa_to_sheet(wiRows);
  wsWi["!cols"] = [
    { wch: 14 },
    { wch: 32 },
    { wch: 8 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
  ];

  // ---- Sheet 2:合約外項目 ----
  // 主要來源是 case_work_items[item_type='extra'](本月有動的列出);舊資料 jsonb 仍附於下方。
  const exRows: (string | number)[][] = [];
  exRows.push([`案件:${caseName} 月份:${ym} 合約外項目（已簽約追加）`]);
  exRows.push([]);
  exRows.push([
    "工項",
    "單位",
    "本月完成量",
    "預計總數量",
    "單價",
    "複價",
    "簽約日期",
    "簽約備註",
  ]);
  for (const it of sorted) {
    if (it.item_type !== "extra") continue;
    const done = monthlyDone.get(it.id) ?? 0;
    if (!done) continue;
    exRows.push([
      it.name,
      it.unit ?? "",
      done,
      it.quantity ?? "",
      it.unit_price ?? "",
      it.total_price ?? "",
      it.contract_signed_at ? it.contract_signed_at.slice(0, 10) : "",
      it.contract_note ?? "",
    ]);
  }
  if (exRows.length === 3) exRows.push(["(本月無合約外工項記錄)", "", "", "", "", "", "", ""]);

  // 舊資料 jsonb 附在下方
  const legacyExtras: { log_date: string; e: DailyLogExtraItem }[] = [];
  for (const log of logs) {
    for (const e of (log.extra_items ?? []) as DailyLogExtraItem[]) {
      legacyExtras.push({ log_date: log.log_date ?? "", e });
    }
  }
  if (legacyExtras.length > 0) {
    exRows.push([]);
    exRows.push(["（舊資料）來自升等前的日誌 jsonb"]);
    exRows.push([
      "日期",
      "施工項目",
      "單位",
      "數量",
      "人數",
      "位置",
      "甲方交辦",
      "事由",
    ]);
    for (const { log_date, e } of legacyExtras) {
      exRows.push([
        log_date,
        e.name ?? "",
        e.unit ?? "",
        e.qty ?? "",
        e.headcount ?? "",
        e.location ?? "",
        e.requested_by ?? "",
        e.reason ?? "",
      ]);
    }
  }

  const wsEx = XLSX.utils.aoa_to_sheet(exRows);
  wsEx["!cols"] = [
    { wch: 24 },
    { wch: 8 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 28 },
  ];

  // ---- Sheet 3:未簽約 ----
  const unRows: (string | number)[][] = [];
  unRows.push([`案件:${caseName} 月份:${ym} 未簽約施工內容`]);
  unRows.push([]);
  unRows.push([
    "工項",
    "單位",
    "本月完成量",
    "預計總數量",
    "單價",
    "複價",
    "報價狀態",
    "備註",
  ]);
  for (const it of sorted) {
    if (it.item_type !== "unsigned") continue;
    const done = monthlyDone.get(it.id) ?? 0;
    if (!done) continue;
    unRows.push([
      it.name,
      it.unit ?? "",
      done,
      it.quantity ?? "",
      it.unit_price ?? "",
      it.total_price ?? "",
      it.quote_status === "quoted" ? "已報價" : "待報價",
      it.brand_note ?? "",
    ]);
  }
  if (unRows.length === 3) unRows.push(["(本月無未簽約工項記錄)", "", "", "", "", "", "", ""]);

  // 舊資料 jsonb
  const legacyUnsigned: { log_date: string; u: DailyLogUnsignedItem }[] = [];
  for (const log of logs) {
    for (const u of (log.unsigned_items ?? []) as DailyLogUnsignedItem[]) {
      legacyUnsigned.push({ log_date: log.log_date ?? "", u });
    }
  }
  if (legacyUnsigned.length > 0) {
    unRows.push([]);
    unRows.push(["（舊資料）來自升等前的日誌 jsonb"]);
    unRows.push([
      "日期",
      "施工項目",
      "單位",
      "數量",
      "人數",
      "類別",
      "報價金額",
      "事由",
    ]);
    for (const { log_date, u } of legacyUnsigned) {
      unRows.push([
        log_date,
        u.name ?? "",
        u.unit ?? "",
        u.qty ?? "",
        u.headcount ?? "",
        u.category ?? "",
        u.quote_amount ?? "",
        u.reason ?? "",
      ]);
    }
  }

  const wsUn = XLSX.utils.aoa_to_sheet(unRows);
  wsUn["!cols"] = [
    { wch: 24 },
    { wch: 8 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 12 },
    { wch: 10 },
    { wch: 28 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsWi, sheetName);
  XLSX.utils.book_append_sheet(wb, wsEx, "合約外");
  XLSX.utils.book_append_sheet(wb, wsUn, "未簽約");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buf;
}
