/**
 * 單案「工程進度表」Excel 產生器。
 *
 * 內容:標單原始 7 欄(項次/項目/單位/數量/單價/複價/編碼) + 累計完成量 + 累計完成 %
 * 排序:依 sort_path,維持階層原順序;skipped=true 略過。
 *
 * 累計完成量:
 *   - 從已 submitted/approved 日誌的 work_items 加總
 *   - qty_mode='percent' 時,qty 是 0-1 fraction,要乘上工項契約量還原成絕對量
 *   - 沒契約量(quantity=null)的工項,完成 % 顯示 "—"
 */
import * as XLSX from "xlsx";
import type {
  CaseWorkItem,
  DailyLogWorkItem,
} from "@/lib/types";

export type CaseWorkItemsXlsxInput = {
  caseName: string;
  caseCode: string | null;
  workItems: CaseWorkItem[];
  /** 已 submitted / approved 日誌的工項記錄 */
  logWorkItems: DailyLogWorkItem[];
};

const HEADERS = [
  "項次",
  "項目",
  "單位",
  "數量",
  "單價",
  "複價",
  "編碼",
  "累計完成量",
  "累計完成 %",
];

/**
 * 產出 Buffer(server side),呼叫端再 base64 包成 dataURL。
 * 注意:此 helper 只負責「資料 → buffer」;不做角色檢查、不從 DB 撈,呼叫端負責。
 */
export function buildCaseWorkItemsXlsx(input: CaseWorkItemsXlsxInput): Buffer {
  const { caseName, caseCode, workItems, logWorkItems } = input;

  // 累計每個 work_item_id 的完成量
  const itemMeta = new Map<string, CaseWorkItem>();
  for (const it of workItems) itemMeta.set(it.id, it);

  const doneByItem = new Map<string, number>();
  for (const w of logWorkItems) {
    if (!w || typeof w.qty !== "number" || !Number.isFinite(w.qty)) continue;
    const meta = itemMeta.get(w.work_item_id);
    const total = meta?.quantity ?? null;
    const inc =
      w.qty_mode === "percent" ? (total ?? 0) * w.qty : w.qty;
    doneByItem.set(
      w.work_item_id,
      (doneByItem.get(w.work_item_id) ?? 0) + inc,
    );
  }

  // 排序:維持 DB sort_path
  const sorted = [...workItems].sort((a, b) =>
    (a.sort_path ?? "").localeCompare(b.sort_path ?? ""),
  );

  const headerRow = [`案件：${caseName}${caseCode ? `（${caseCode}）` : ""}`];
  const titleRow = [
    `匯出日期：${new Date().toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}`,
  ];

  const rows: (string | number)[][] = [headerRow, titleRow, [], HEADERS];

  for (const it of sorted) {
    if (it.skipped) continue;
    const indent = "  ".repeat(Math.max(0, it.depth ?? 0));
    const done = doneByItem.get(it.id);
    const total = it.quantity;
    const pctDisplay =
      total !== null && total !== undefined && total > 0 && done !== undefined
        ? Math.round((done / total) * 1000) / 10
        : null;

    rows.push([
      indent + (it.tender_code ?? ""),  // 項次（用 tender_code 當對外編號）
      indent + it.name,
      it.unit ?? "",
      it.quantity ?? "",
      it.unit_price ?? "",
      it.total_price ?? "",
      it.tender_code ?? "",
      done ?? "",
      pctDisplay !== null ? pctDisplay : "",
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // 欄寬(粗略):項目欄寬一點,其他常規
  ws["!cols"] = [
    { wch: 12 }, // 項次
    { wch: 32 }, // 項目
    { wch: 8 },  // 單位
    { wch: 10 }, // 數量
    { wch: 12 }, // 單價
    { wch: 14 }, // 複價
    { wch: 14 }, // 編碼
    { wch: 12 }, // 累計完成量
    { wch: 12 }, // 累計完成 %
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "工程進度表");

  // 強制 type 為 buffer(node 端)
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buf;
}
