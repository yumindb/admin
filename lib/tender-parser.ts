/**
 * 標單 Excel 解析器
 *
 * 目標：把裕民工務的 7 欄標單 .xlsx 轉成階層化的工項樹。
 *
 * 標單格式（依 _work/biaodan_analysis.txt 與兩份範例）：
 *   Col A: 項次（如 壹.二.10.1.4.24，可達 6 層；可空，空表示沿用上一個 item 的子項）
 *   Col B: 項目及說明（含換行的 spec 內容）
 *   Col C: 單位（M / 式 / 組 / 只 ...）
 *   Col D: 數量
 *   Col E: 單價
 *   Col F: 複價
 *   Col G: 編碼(備註) — 廠牌候選
 *
 * 階層判定：
 *   - section：項次層級淺（≤2 層）或標題（如「機電工程」）— 不會有單位/數量
 *   - item   ：有項次 + 有單位/數量
 *   - spec   ：項次空 + 有單位/數量（屬上一個 item 的規格子項）
 *   - skip   ：「小計」、空白行、表頭重複、雜訊
 *
 * Sort path 為 zero-padded segment（每段 4 碼），保證 ORDER BY 正確。
 */

import * as XLSX from "xlsx";

export type ParsedRow = {
  rowIndex: number;       // 原 Excel row（1-based）
  type: "section" | "item" | "spec" | "skip";
  tenderCode: string | null;
  name: string;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  brandNote: string | null;
  specText: string | null;
  reason?: string;        // skip 的原因
};

export type ParsedNode = ParsedRow & {
  id: string;             // 暫時 id（client-side preview 用）
  depth: number;
  sortPath: string;
  parentId: string | null;
  children: ParsedNode[];
  skippedByUser: boolean; // preview 上勾「略過」用
};

export type ParseResult = {
  rows: ParsedRow[];
  tree: ParsedNode[];
  stats: {
    rows: number;
    sections: number;
    items: number;
    specs: number;
    skipped: number;
  };
  warnings: { row: number; msg: string }[];
};

const HEADER_HINT = ["項 次", "項次", "項目", "單 位", "單位", "數 量", "數量"];
const SKIP_PATTERNS = [
  /^小計/,
  /^合計/,
  /^總計/,
  /^詳細價目表/,
  /^工程名稱/,
  /^施工地點/,
  /^會計科目/,
  /^工程編號/,
];

function trim(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\u3000/g, " ").trim();
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 算項次的階層深度（"壹.二.10.1.4.24" → 6） */
function codeDepth(code: string): number {
  if (!code) return 0;
  return code.split(".").filter(Boolean).length;
}

/**
 * 把 Excel sheet 解析成 ParsedRow[] + 階層樹
 */
export function parseTenderSheet(sheet: XLSX.WorkSheet): ParseResult {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
    blankrows: true,
  });

  const rows: ParsedRow[] = [];
  const warnings: { row: number; msg: string }[] = [];
  let headerSeen = false;

  for (let i = 0; i < matrix.length; i++) {
    const r = matrix[i] ?? [];
    const rowIndex = i + 1;

    const code = trim(r[0]);
    const name = trim(r[1]);
    const unit = trim(r[2]);
    const qty = toNumber(r[3]);
    const unitPrice = toNumber(r[4]);
    const totalPrice = toNumber(r[5]);
    const brand = trim(r[6]);

    // 偵測表頭那一列（中間任一格符合）
    const isHeader = HEADER_HINT.some(
      (h) => code === h || name.replace(/\s+/g, "") === h.replace(/\s+/g, "")
    );
    if (isHeader) {
      headerSeen = true;
      rows.push(skipRow(rowIndex, "表頭"));
      continue;
    }

    // 表頭前的雜訊（標題、工程名稱）一律 skip
    if (!headerSeen) {
      if (!code && !name && !unit && qty === null) {
        rows.push(skipRow(rowIndex, "空白行"));
      } else {
        rows.push(skipRow(rowIndex, "表頭前的標題列"));
      }
      continue;
    }

    // 全空行
    if (!code && !name && !unit && qty === null && unitPrice === null && totalPrice === null && !brand) {
      rows.push(skipRow(rowIndex, "空白行"));
      continue;
    }

    // 「小計」「合計」等
    if (SKIP_PATTERNS.some((p) => p.test(name) || p.test(code))) {
      rows.push(skipRow(rowIndex, "小計／表頭重複"));
      continue;
    }

    // 多行 cell 換行保留
    const specName = name; // already trim'd but with internal \n preserved by XLSX

    const hasMeasure = unit !== "" || qty !== null;

    if (code) {
      // 有項次 → section 或 item
      // 規則:沒有 unit/qty 一律當 section(分類層,可任何深度);有 unit/qty → item
      // 例如 "壹.二.10.3.1 給排水衛生設備工程" 雖 depth=5 但無 unit → section
      // "壹.二.10.1.4.24 EMT管 E19" depth=6 有 unit M → item
      const isSection = !hasMeasure;
      if (isSection) {
        rows.push({
          rowIndex,
          type: "section",
          tenderCode: code,
          name: specName || "(未命名分類)",
          unit: null,
          quantity: null,
          unitPrice: null,
          totalPrice: null,
          brandNote: null,
          specText: null,
        });
      } else {
        if (!specName) {
          warnings.push({ row: rowIndex, msg: "有項次但無項目名稱" });
        }
        rows.push({
          rowIndex,
          type: "item",
          tenderCode: code,
          name: specName || "(未命名項目)",
          unit: unit || null,
          quantity: qty,
          unitPrice,
          totalPrice,
          brandNote: brand || null,
          specText: specName.includes("\n") ? specName : null,
        });
      }
    } else {
      // 沒項次 → spec（接到上一個 item）或被 skip
      if (!specName && !hasMeasure) {
        rows.push(skipRow(rowIndex, "空白行"));
        continue;
      }
      if (!hasMeasure) {
        rows.push(skipRow(rowIndex, "無項次也無數量"));
        continue;
      }
      rows.push({
        rowIndex,
        type: "spec",
        tenderCode: null,
        name: specName || "(規格未命名)",
        unit: unit || null,
        quantity: qty,
        unitPrice,
        totalPrice,
        brandNote: brand || null,
        specText: specName.includes("\n") ? specName : null,
      });
    }
  }

  const { tree, stats } = buildTree(rows);
  return { rows, tree, stats, warnings };
}

function skipRow(rowIndex: number, reason: string): ParsedRow {
  return {
    rowIndex,
    type: "skip",
    tenderCode: null,
    name: "",
    unit: null,
    quantity: null,
    unitPrice: null,
    totalPrice: null,
    brandNote: null,
    specText: null,
    reason,
  };
}

/**
 * 把扁平 ParsedRow 轉成階層樹。
 * 規則：
 *   - section 用 tenderCode 的「.」前綴關係決定父子（壹.二.10 是 壹.二 的子；壹.二.10.1 是 壹.二.10 的子）
 *   - item 接到「最深 prefix 相符」的 section 下
 *   - spec 接到「上一個 item」下
 */
function buildTree(rows: ParsedRow[]): {
  tree: ParsedNode[];
  stats: ParseResult["stats"];
} {
  const tree: ParsedNode[] = [];
  const sectionStack: ParsedNode[] = []; // 維護當前每一層 section 的指標
  let currentItem: ParsedNode | null = null;
  let serial = 0;
  const counters: number[] = [];

  const stats = { rows: 0, sections: 0, items: 0, specs: 0, skipped: 0 };

  function nextSortAt(depth: number): string {
    while (counters.length <= depth) counters.push(0);
    counters[depth] = (counters[depth] ?? 0) + 1;
    counters.length = depth + 1;
    return counters.map((n) => String(n).padStart(4, "0")).join(".");
  }

  for (const row of rows) {
    stats.rows++;
    if (row.type === "skip") {
      stats.skipped++;
      continue;
    }

    if (row.type === "section") {
      const codeDepthVal = row.tenderCode ? codeDepth(row.tenderCode) : 0;
      // 找父 section：sectionStack 內 tenderCode 是當前的 prefix
      let parent: ParsedNode | null = null;
      for (let i = sectionStack.length - 1; i >= 0; i--) {
        const s = sectionStack[i];
        if (
          row.tenderCode &&
          s.tenderCode &&
          row.tenderCode.startsWith(s.tenderCode + ".")
        ) {
          parent = s;
          break;
        }
      }
      const depth = parent ? parent.depth + 1 : 0;
      const sortPath = nextSortAt(depth);

      const node: ParsedNode = {
        ...row,
        id: `n${++serial}`,
        depth,
        sortPath,
        parentId: parent?.id ?? null,
        children: [],
        skippedByUser: false,
      };
      if (parent) parent.children.push(node);
      else tree.push(node);

      // 重設 sectionStack 到當前深度
      sectionStack.length = depth;
      sectionStack.push(node);
      currentItem = null; // 換 section 後 spec 不再附在舊 item
      stats.sections++;
      // 順便標記 codeDepthVal 已用過（避免 lint 警告）
      void codeDepthVal;
      continue;
    }

    if (row.type === "item") {
      const parent = sectionStack[sectionStack.length - 1] ?? null;
      const depth = parent ? parent.depth + 1 : 0;
      const sortPath = nextSortAt(depth);
      const node: ParsedNode = {
        ...row,
        id: `n${++serial}`,
        depth,
        sortPath,
        parentId: parent?.id ?? null,
        children: [],
        skippedByUser: false,
      };
      if (parent) parent.children.push(node);
      else tree.push(node);
      currentItem = node;
      stats.items++;
      continue;
    }

    if (row.type === "spec") {
      const parent = currentItem ?? sectionStack[sectionStack.length - 1] ?? null;
      const depth = parent ? parent.depth + 1 : 0;
      const sortPath = nextSortAt(depth);
      const node: ParsedNode = {
        ...row,
        id: `n${++serial}`,
        depth,
        sortPath,
        parentId: parent?.id ?? null,
        children: [],
        skippedByUser: false,
      };
      if (parent) parent.children.push(node);
      else tree.push(node);
      stats.specs++;
      continue;
    }
  }

  return { tree, stats };
}

/**
 * 把 .xlsx 的 ArrayBuffer 解析成第一個工作表的 ParseResult。
 * 多 sheet 的處理：取第一個非空 sheet（範例都只有一個）。
 */
export function parseTenderArrayBuffer(buf: ArrayBuffer): ParseResult & {
  sheetName: string;
} {
  const wb = XLSX.read(buf, { type: "array", cellDates: true, cellNF: false });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const result = parseTenderSheet(sheet);
  return { ...result, sheetName };
}

/** 把樹攤平回扁平陣列（保持 sort_path 順序），給 import server action 用 */
export function flattenTree(nodes: ParsedNode[]): ParsedNode[] {
  const out: ParsedNode[] = [];
  function walk(arr: ParsedNode[]) {
    for (const n of arr) {
      out.push(n);
      if (n.children.length) walk(n.children);
    }
  }
  walk(nodes);
  return out;
}
