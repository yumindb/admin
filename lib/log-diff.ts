/**
 * 日誌「送出後編輯」的前後對照(2026-08 業主要求)。
 *
 * 背景:
 *   辦公室助理可以直接改主任填錯 / 填太少的日誌(工項、數量、人數都能改)。
 *   老闆要看得到「改了什麼」— 不用很顯眼,但點開要能對照原文。
 *
 * 資料來源:
 *   daily_log_revisions 每筆存的是「這次編輯**之前**的完整快照」(snapshot)。
 *   所以某一筆 revision 的「改後」= 下一筆(較新)revision 的 snapshot;
 *   最新那筆的「改後」= daily_logs 現在的值。呼叫端把 revisions 依時間**新到舊**
 *   傳進來,這裡負責串成一對一對的 before/after。
 *
 * 這裡只做「人看得懂的摘要」,不是逐字 diff — 業主要的是「哪裡被動過」,
 * 完整原始值仍在 snapshot jsonb 裡,必要時可查。
 */
import type {
  DailyLogEditableField,
  DailyLogExtraItem,
  DailyLogManpower,
  DailyLogSnapshot,
  DailyLogUnsignedItem,
  DailyLogWorkItem,
  LogPhoto,
} from "./types";
import { formatWeatherSummary } from "./daily-log";
import { formatDateTW } from "./datetime";

/** 工項 id → 顯示名稱 / 單位。查不到(工項被刪)時回 null */
export type WorkItemLookup = (
  id: string,
) => { name: string; unit: string | null } | null;

export type FieldChange = {
  field: DailyLogEditableField;
  label: string;
  /** 每個 row 是一項具體改動;文字欄位只有一 row */
  rows: { label?: string; before: string; after: string }[];
};

export type RevisionDiff = {
  /** daily_log_revisions.id */
  id: string;
  changes: FieldChange[];
};

const FIELD_LABEL: Record<DailyLogEditableField, string> = {
  log_date: "日期",
  weather: "天氣",
  manpower: "出工 / 點工 / 外包 / 機具",
  work_items: "施工工項",
  extra_items: "非合約內項目",
  unsigned_items: "未簽約項目",
  photos: "照片",
  vendor_notices: "通知協力廠商事項",
  notes: "重要事項紀錄",
};

export const EMPTY_MARK = "（空白）";

function text(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return s === "" ? EMPTY_MARK : s;
}

function num(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : EMPTY_MARK;
}

/** 工項數量:percent 模式存的是 0-1 的比例,顯示成百分比才看得懂 */
function formatQty(w: DailyLogWorkItem, unit: string | null): string {
  if (w.qty_mode === "percent") {
    return `${Math.round((w.qty ?? 0) * 1000) / 10}%`;
  }
  const n = typeof w.qty === "number" ? w.qty : 0;
  return unit ? `${n} ${unit}` : String(n);
}

/** 出工 / 點工 / 外包 / 機具 — 只列真的變動的那幾項 */
function diffManpower(
  before: DailyLogManpower | null | undefined,
  after: DailyLogManpower | null | undefined,
): FieldChange["rows"] {
  const b = before ?? {};
  const a = after ?? {};
  const rows: FieldChange["rows"] = [];

  if (b.today_total !== a.today_total) {
    rows.push({
      label: "本日出工人數",
      before: num(b.today_total),
      after: num(a.today_total),
    });
  }
  if (b.day_labor !== a.day_labor) {
    rows.push({
      label: "本日點工人數",
      before: num(b.day_labor),
      after: num(a.day_labor),
    });
  }
  if ((b.day_labor_note ?? "") !== (a.day_labor_note ?? "")) {
    rows.push({
      label: "點工工作內容",
      before: text(b.day_labor_note),
      after: text(a.day_labor_note),
    });
  }

  // 外包工別 / 機具:以名稱為 key 比人數,增刪也列出來
  const namedRows = (
    kind: "外包工別" | "機具",
    bl: { key: string; today?: number }[],
    al: { key: string; today?: number }[],
  ) => {
    const bMap = new Map(bl.filter((x) => x.key).map((x) => [x.key, x.today]));
    const aMap = new Map(al.filter((x) => x.key).map((x) => [x.key, x.today]));
    for (const key of new Set([...bMap.keys(), ...aMap.keys()])) {
      const hasB = bMap.has(key);
      const hasA = aMap.has(key);
      const bv = bMap.get(key);
      const av = aMap.get(key);
      if (hasB && hasA && bv === av) continue;
      rows.push({
        label: `${kind}：${key}`,
        before: hasB ? `${num(bv)} 人次` : "（沒有這項）",
        after: hasA ? `${num(av)} 人次` : "（已刪除）",
      });
    }
  };
  namedRows(
    "外包工別",
    (b.subcontractors ?? []).map((s) => ({ key: (s.trade ?? "").trim(), today: s.today })),
    (a.subcontractors ?? []).map((s) => ({ key: (s.trade ?? "").trim(), today: s.today })),
  );
  namedRows(
    "機具",
    (b.machines ?? []).map((m) => ({ key: (m.name ?? "").trim(), today: m.today })),
    (a.machines ?? []).map((m) => ({ key: (m.name ?? "").trim(), today: m.today })),
  );

  return rows;
}

function diffWorkItems(
  before: DailyLogWorkItem[],
  after: DailyLogWorkItem[],
  lookup: WorkItemLookup,
): FieldChange["rows"] {
  const rows: FieldChange["rows"] = [];
  const bMap = new Map(before.map((w) => [w.work_item_id, w]));
  const aMap = new Map(after.map((w) => [w.work_item_id, w]));
  for (const id of new Set([...bMap.keys(), ...aMap.keys()])) {
    const bw = bMap.get(id);
    const aw = aMap.get(id);
    const meta = lookup(id);
    const name = meta?.name ?? "（工項已刪除）";
    const unit = meta?.unit ?? null;
    if (bw && aw) {
      const bq = formatQty(bw, unit);
      const aq = formatQty(aw, unit);
      const bn = (bw.note ?? "").trim();
      const an = (aw.note ?? "").trim();
      if (bq !== aq) rows.push({ label: name, before: bq, after: aq });
      if (bn !== an) {
        rows.push({ label: `${name}（備註）`, before: text(bn), after: text(an) });
      }
    } else if (aw) {
      rows.push({ label: name, before: "（原本沒有這項）", after: formatQty(aw, unit) });
    } else if (bw) {
      rows.push({ label: name, before: formatQty(bw, unit), after: "（已刪除）" });
    }
  }
  return rows;
}

/** 舊格式的自由填寫項目(extra_items / unsigned_items):比名稱與數量 */
function diffLooseItems(
  before: (DailyLogExtraItem | DailyLogUnsignedItem)[],
  after: (DailyLogExtraItem | DailyLogUnsignedItem)[],
): FieldChange["rows"] {
  const key = (x: DailyLogExtraItem | DailyLogUnsignedItem) =>
    (x.name ?? "").trim();
  const fmt = (x: DailyLogExtraItem | DailyLogUnsignedItem) =>
    `${x.qty ?? 0}${x.unit ? ` ${x.unit}` : ""}`;
  const bMap = new Map(before.filter((x) => key(x)).map((x) => [key(x), x]));
  const aMap = new Map(after.filter((x) => key(x)).map((x) => [key(x), x]));
  const rows: FieldChange["rows"] = [];
  for (const k of new Set([...bMap.keys(), ...aMap.keys()])) {
    const b = bMap.get(k);
    const a = aMap.get(k);
    if (b && a) {
      if (fmt(b) !== fmt(a)) rows.push({ label: k, before: fmt(b), after: fmt(a) });
    } else if (a) {
      rows.push({ label: k, before: "（原本沒有這項）", after: fmt(a) });
    } else if (b) {
      rows.push({ label: k, before: fmt(b), after: "（已刪除）" });
    }
  }
  return rows;
}

/** 照片:只比張數與說明文字(路徑對使用者沒意義) */
function diffPhotos(
  before: LogPhoto[],
  after: LogPhoto[],
): FieldChange["rows"] {
  const rows: FieldChange["rows"] = [];
  if (before.length !== after.length) {
    rows.push({
      label: "張數",
      before: `${before.length} 張`,
      after: `${after.length} 張`,
    });
  }
  // 同一張照片(同 path)的說明被改掉
  const bMap = new Map(before.map((p) => [p.path, p.caption ?? ""]));
  for (const p of after) {
    const bc = bMap.get(p.path);
    if (bc === undefined) continue;
    const ac = p.caption ?? "";
    if (bc !== ac) {
      rows.push({ label: "照片說明", before: text(bc), after: text(ac) });
    }
  }
  if (rows.length === 0 && before.length === after.length) {
    // 張數一樣但 jsonb 有變(換照片 / 重新標註)— 至少講一句,不要顯示空白
    rows.push({
      label: "照片內容",
      before: `${before.length} 張`,
      after: `${after.length} 張（有照片被更換或重新標註）`,
    });
  }
  return rows;
}

/**
 * 算出一筆編輯的前後對照。
 *
 * @param snapshot      這次編輯**之前**的內容(daily_log_revisions.snapshot)
 * @param after         這次編輯**之後**的內容(下一筆較新 revision 的 snapshot,
 *                      或最新一筆用 daily_logs 現值)
 * @param changedFields revision 記錄的變動欄位;沒記錄就全部比一遍
 */
export function diffSnapshot(
  snapshot: DailyLogSnapshot,
  after: DailyLogSnapshot,
  changedFields: DailyLogEditableField[],
  lookup: WorkItemLookup,
): FieldChange[] {
  const fields: DailyLogEditableField[] =
    changedFields.length > 0
      ? changedFields
      : (Object.keys(FIELD_LABEL) as DailyLogEditableField[]);
  const out: FieldChange[] = [];

  for (const field of fields) {
    const label = FIELD_LABEL[field] ?? field;
    let rows: FieldChange["rows"] = [];

    switch (field) {
      case "log_date":
        if (snapshot.log_date !== after.log_date) {
          rows = [
            {
              before: snapshot.log_date ? formatDateTW(snapshot.log_date) : EMPTY_MARK,
              after: after.log_date ? formatDateTW(after.log_date) : EMPTY_MARK,
            },
          ];
        }
        break;
      case "weather": {
        const b = formatWeatherSummary(snapshot.weather);
        const a = formatWeatherSummary(after.weather);
        if (b !== a) rows = [{ before: text(b), after: text(a) }];
        break;
      }
      case "manpower":
        rows = diffManpower(snapshot.manpower, after.manpower);
        break;
      case "work_items":
        rows = diffWorkItems(
          snapshot.work_items ?? [],
          after.work_items ?? [],
          lookup,
        );
        break;
      case "extra_items":
        rows = diffLooseItems(snapshot.extra_items ?? [], after.extra_items ?? []);
        break;
      case "unsigned_items":
        rows = diffLooseItems(
          snapshot.unsigned_items ?? [],
          after.unsigned_items ?? [],
        );
        break;
      case "photos":
        rows = diffPhotos(snapshot.photos ?? [], after.photos ?? []);
        break;
      case "vendor_notices":
        if ((snapshot.vendor_notices ?? "") !== (after.vendor_notices ?? "")) {
          rows = [
            { before: text(snapshot.vendor_notices), after: text(after.vendor_notices) },
          ];
        }
        break;
      case "notes":
        if ((snapshot.notes ?? "") !== (after.notes ?? "")) {
          rows = [{ before: text(snapshot.notes), after: text(after.notes) }];
        }
        break;
    }

    // 欄位被標記為有變但算不出具體差異(例如只動了照片排序)→ 仍列出欄位名,
    // 免得使用者看到「改了 3 個欄位」卻只列出 2 個而懷疑系統漏記。
    if (rows.length === 0) {
      rows = [{ before: "（內容有調整）", after: "（詳見目前內容）" }];
    }
    out.push({ field, label, rows });
  }

  return out;
}

/**
 * 一次算完整份日誌的編輯軌跡。
 *
 * @param revisions 依 edited_at **新到舊**排序(與詳情頁的查詢一致)
 * @param current   daily_logs 現在的值 = 最新一筆編輯的「改後」
 */
export function buildRevisionDiffs(
  revisions: { id: string; snapshot: DailyLogSnapshot; changedFields: DailyLogEditableField[] }[],
  current: DailyLogSnapshot,
  lookup: WorkItemLookup,
): RevisionDiff[] {
  return revisions.map((r, i) => ({
    id: r.id,
    // 新到舊:第 0 筆的「改後」是現值,其餘是前一筆(較新)那次編輯前的快照
    changes: diffSnapshot(
      r.snapshot,
      i === 0 ? current : revisions[i - 1].snapshot,
      r.changedFields ?? [],
      lookup,
    ),
  }));
}
