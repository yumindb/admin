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
  /** 每個 row 是一項具體改動;文字欄位只有一 row。多筆時只留前 MAX_ROWS 筆 */
  rows: { label?: string; before: string; after: string }[];
  /** 一句話總結(工項一次改很多筆時,逐行列出反而看不懂) */
  summary?: string;
  /** 因為超過上限而沒列出的筆數 */
  more?: number;
};

/**
 * 單一欄位最多列幾行。
 * 助理一次補 84 個工項是真的會發生的(主任漏勾一整區),逐行列出等於洗版。
 */
const MAX_ROWS = 8;

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

/**
 * key 順序無關的 JSON 序列化,用來比對「這個欄位真的變了嗎」。
 *
 * 為什麼需要:jsonb 寫進 Postgres 再讀回來,key 順序會被重排
 * (例:`{today_total, subcontractors}` → `{subcontractors, today_total}`)。
 * 直接 JSON.stringify 比對會把「內容一樣、順序不同」判成有變 →
 * daily_log_revisions.changed_fields 出現一堆沒改的欄位。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

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
): { rows: FieldChange["rows"]; summary?: string } {
  const rows: FieldChange["rows"] = [];
  let added = 0;
  let removed = 0;
  let edited = 0;
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
      if (bq !== aq) {
        edited++;
        rows.push({ label: name, before: bq, after: aq });
      }
      if (bn !== an) {
        edited++;
        rows.push({ label: `${name}（備註）`, before: text(bn), after: text(an) });
      }
    } else if (aw) {
      added++;
      rows.push({ label: name, before: "（原本沒有這項）", after: formatQty(aw, unit) });
    } else if (bw) {
      removed++;
      rows.push({ label: name, before: formatQty(bw, unit), after: "（已刪除）" });
    }
  }

  // 一次動很多筆時先給一句總結,細節只列前幾筆(完整內容仍在 snapshot)
  const total = added + removed + edited;
  const summary =
    total > MAX_ROWS
      ? [
          added > 0 ? `新增 ${added} 項` : null,
          removed > 0 ? `刪除 ${removed} 項` : null,
          edited > 0 ? `數量／備註調整 ${edited} 項` : null,
        ]
          .filter(Boolean)
          .join("、")
      : undefined;
  return { rows, summary };
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
  // 張數一樣但換了照片 / 重新標註(path 變了)。
  // 只在 path 集合真的不同時才講 — 不然 jsonb key 順序造成的誤判會天天冒出來。
  const bPaths = new Set(before.map((p) => p.path));
  const swapped = after.filter((p) => !bPaths.has(p.path)).length;
  if (rows.length === 0 && swapped > 0) {
    rows.push({
      label: "照片內容",
      before: `${before.length} 張`,
      after: `${after.length} 張（其中 ${swapped} 張被更換或重新標註）`,
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
    let summary: string | undefined;

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
      case "work_items": {
        const r = diffWorkItems(
          snapshot.work_items ?? [],
          after.work_items ?? [],
          lookup,
        );
        rows = r.rows;
        summary = r.summary;
        break;
      }
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

    // 算不出任何差異就整個欄位不列。
    //
    // 為什麼會有「被標記改過但實際沒差」的欄位:jsonb 存進 Postgres 再讀回來,
    // key 的順序會被正規化,而 saveLogAction 是用 JSON.stringify 逐欄比對 —
    // 同樣內容不同 key 順序會被判定成「有變」。與其列一行沒有內容的
    //「（內容有調整）」污染畫面,不如不列;欄位名的小標籤仍會顯示。
    // (根因已在 saveLogAction 改用 stableStringify 修掉,但既有紀錄仍帶著誤判。)
    if (rows.length === 0) continue;

    out.push({
      field,
      label,
      rows: rows.slice(0, MAX_ROWS),
      summary,
      more: rows.length > MAX_ROWS ? rows.length - MAX_ROWS : undefined,
    });
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
