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

export type ParsedHeader = {
  /** 工程名稱 — 通常在第 1 列 A 欄整段，或「工程名稱」標籤旁 */
  name: string | null;
  /** 施工地點 — 「施工地點」標籤旁 */
  location: string | null;
  /** 工程編號 — 「工程編號」標籤旁；範例多為空 */
  code: string | null;
  /** 業主／發包單位 — 標單通常沒寫，留空 */
  client: string | null;
};

export type ParseResult = {
  rows: ParsedRow[];
  tree: ParsedNode[];
  header: ParsedHeader;
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
  return parseTenderMatrix(matrix);
}

/** 標單矩陣→ParseResult(內部入口,parseTenderArrayBuffer 多 sheet 流程用) */
export function parseTenderMatrix(matrix: unknown[][]): ParseResult {
  const rows: ParsedRow[] = [];
  const warnings: { row: number; msg: string }[] = [];
  const header = parseTenderHeader(matrix);
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
  return { rows, tree, header, stats, warnings };
}

/**
 * 從表頭區（「項 次」表頭那列以前）抽出工程名稱、施工地點、工程編號、客戶。
 *
 * 標單範例（公家工程）：
 *   - 第 1 列 A 欄：完整工程名稱（純文字）
 *   - 中段：A=「工程名稱」/B=名稱、A=「施工地點」/B=地點、E=「工程編號」/F=編號
 *
 * 報價單範例：
 *   - 第 1 列 A 欄：「報 價 單」或「裕民工務 - 報 價 單」(視為標題,非名稱)
 *   - A=「工地名稱」/B=工程名稱、A=「工程地點」/B=地點、A=「客戶名稱」/B=客戶
 *
 * 兩種格式統一處理：認標籤、抓右邊第一個非空。第 1 列 A 欄非標題時當 name 備援。
 */
const HEADER_NAME_LABELS = new Set(["工程名稱", "工地名稱"]);
const HEADER_LOC_LABELS = new Set(["施工地點", "工程地點"]);
const HEADER_CODE_LABELS = new Set(["工程編號"]);
const HEADER_CLIENT_LABELS = new Set(["客戶名稱", "客戶", "業主"]);

export function parseTenderHeader(matrix: unknown[][]): ParsedHeader {
  const header: ParsedHeader = { name: null, location: null, code: null, client: null };
  const stripSpaces = (s: string) => s.replace(/\s+/g, "");

  // 第 1 列 A 欄：純文字工程名稱（備援，排除常見標題字樣）
  if (matrix.length > 0) {
    const firstA = trim(matrix[0]?.[0]);
    if (
      firstA &&
      !/詳細價目表|標\s*單|報\s*價\s*單|工程名稱|工地名稱|施工地點|工程地點|工程編號|客戶/.test(
        firstA
      )
    ) {
      header.name = firstA;
    }
  }

  for (let i = 0; i < matrix.length; i++) {
    const r = matrix[i] ?? [];
    const a = stripSpaces(trim(r[0]));

    // 撞到「項次」表頭就停
    if (a === "項次" || stripSpaces(trim(r[1])) === "項目及說明" || stripSpaces(trim(r[1])) === "項目") {
      break;
    }

    for (let c = 0; c < r.length; c++) {
      const cell = stripSpaces(trim(r[c]));
      if (!cell) continue;
      const next = pickNextNonEmpty(r, c);
      if (!next) continue;
      if (HEADER_NAME_LABELS.has(cell)) header.name = next;
      else if (HEADER_LOC_LABELS.has(cell)) header.location = next;
      else if (HEADER_CODE_LABELS.has(cell)) header.code = next;
      else if (HEADER_CLIENT_LABELS.has(cell)) header.client = next;
    }
  }

  return header;
}

function pickNextNonEmpty(r: unknown[], from: number): string | null {
  for (let c = from + 1; c < r.length; c++) {
    const v = trim(r[c]);
    if (v) return v;
  }
  return null;
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

/** 哪一種 7 欄格式 */
export type SheetFormat = "tender" | "quote";

/**
 * 從 sheet 矩陣判斷是公家標單還是報價單。
 *   - 標單表頭 G 欄是「編碼(備註)」或含「編碼／備註」字樣
 *   - 報價單表頭 G 欄是「註」、Row 1 含「報價單」
 *   - 找不到表頭就猜 tender(預設）
 */
function detectFormat(matrix: unknown[][]): SheetFormat {
  const stripSpaces = (s: string) => s.replace(/\s+/g, "");
  for (let i = 0; i < Math.min(matrix.length, 30); i++) {
    const r = matrix[i] ?? [];
    const a = stripSpaces(trim(r[0]));
    if (a !== "項次") continue;
    const b = stripSpaces(trim(r[1]));
    const g = stripSpaces(trim(r[6]));
    if (g === "註") return "quote";
    if (g.includes("編碼") || g.includes("備註")) return "tender";
    // fallback：「項目及說明」是標單；「項目」是報價單
    if (b === "項目") return "quote";
    return "tender";
  }
  // row 1 含「報價單」也算
  const row1 = stripSpaces(trim(matrix[0]?.[0]));
  if (row1.includes("報價單")) return "quote";
  return "tender";
}

/**
 * 報價單 sheet → ParseResult。
 *
 * 結構：
 *   - 表頭列：項次｜項目｜單位｜數量｜單價｜複價｜註
 *   - 項次是純整數，沒有 6 層階層
 *   - G 欄(註) 是分類字串(拆除工程／泥作工程／…)；連續同分類 group 成一個 section
 *   - 結尾遇到「以下空白／小計／稅金／總計」停止
 */
export function parseQuoteSheet(matrix: unknown[][]): ParseResult {
  const rows: ParsedRow[] = [];
  const warnings: { row: number; msg: string }[] = [];
  const header = parseTenderHeader(matrix);

  let headerIdx = -1;
  const stripSpaces = (s: string) => s.replace(/\s+/g, "");
  for (let i = 0; i < matrix.length; i++) {
    const r = matrix[i] ?? [];
    if (stripSpaces(trim(r[0])) === "項次") {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    return {
      rows: [],
      tree: [],
      header,
      stats: { rows: 0, sections: 0, items: 0, specs: 0, skipped: 0 },
      warnings: [{ row: 0, msg: "找不到「項次」表頭列" }],
    };
  }

  let currentSection: string | null = null;
  let sectionSerial = 0;
  let stopped = false; // 撞到「以下空白／小計／…」就停,後面整段不再當資料
  // 報價單終止字樣
  const QUOTE_END = /^(以\s*下\s*空\s*白|小\s*計|稅\s*金|合\s*計|總\s*計|備\s*註)/;

  for (let i = 0; i <= headerIdx; i++) {
    rows.push(skipRow(i + 1, i === headerIdx ? "表頭" : "表頭前的標題列"));
  }

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i] ?? [];
    const rowIndex = i + 1;

    if (stopped) {
      rows.push(skipRow(rowIndex, "結束標記後"));
      continue;
    }

    const code = trim(r[0]);
    const name = trim(r[1]);
    const unit = trim(r[2]);
    const qty = toNumber(r[3]);
    const unitPrice = toNumber(r[4]);
    const totalPrice = toNumber(r[5]);
    const note = trim(r[6]);

    if (!code && !name && !unit && qty === null && unitPrice === null && totalPrice === null && !note) {
      rows.push(skipRow(rowIndex, "空白行"));
      continue;
    }
    if (QUOTE_END.test(stripSpaces(code)) || QUOTE_END.test(stripSpaces(name))) {
      stopped = true;
      rows.push(skipRow(rowIndex, "結束/小計"));
      continue;
    }

    // 報價單嚴格要求：必須是純數字項次,否則一律 skip(避免把頁尾公司列當 item)
    const codeNumeric = /^\d+(\.\d+)?$/.test(code);
    if (!codeNumeric) {
      rows.push(skipRow(rowIndex, "非數字項次"));
      continue;
    }
    const hasMeasure = unit !== "" || qty !== null;
    if (!hasMeasure) {
      rows.push(skipRow(rowIndex, "無單位／數量"));
      continue;
    }
    if (!name) {
      warnings.push({ row: rowIndex, msg: "有項次但無項目名稱" });
    }

    // 註欄是分類 — 連續同註 group 成一個 section
    if (note && note !== currentSection) {
      sectionSerial++;
      currentSection = note;
      rows.push({
        rowIndex: rowIndex - 0.5,
        type: "section",
        tenderCode: `第${sectionSerial}類`,
        name: note,
        unit: null,
        quantity: null,
        unitPrice: null,
        totalPrice: null,
        brandNote: null,
        specText: null,
      });
    }

    rows.push({
      rowIndex,
      type: "item",
      tenderCode: code || null,
      name: name || "(未命名項目)",
      unit: unit || null,
      quantity: qty,
      unitPrice,
      totalPrice,
      brandNote: null,
      specText: name.includes("\n") ? name : null,
    });
  }

  const { tree, stats } = buildFlatTree(rows);
  return { rows, tree, header, stats, warnings };
}

/** 報價單用的扁平樹 — section 在 depth 0、item 在 depth 1，無多層巢狀。 */
function buildFlatTree(rows: ParsedRow[]): { tree: ParsedNode[]; stats: ParseResult["stats"] } {
  const tree: ParsedNode[] = [];
  let currentSection: ParsedNode | null = null;
  let serial = 0;
  let sectionCounter = 0;
  let itemCounter = 0;
  const stats = { rows: 0, sections: 0, items: 0, specs: 0, skipped: 0 };

  const pad4 = (n: number) => String(n).padStart(4, "0");

  for (const row of rows) {
    stats.rows++;
    if (row.type === "skip") {
      stats.skipped++;
      continue;
    }
    if (row.type === "section") {
      sectionCounter++;
      itemCounter = 0;
      const node: ParsedNode = {
        ...row,
        id: `n${++serial}`,
        depth: 0,
        sortPath: pad4(sectionCounter),
        parentId: null,
        children: [],
        skippedByUser: false,
      };
      tree.push(node);
      currentSection = node;
      stats.sections++;
      continue;
    }
    if (row.type === "item") {
      itemCounter++;
      const parent = currentSection;
      const depth = parent ? 1 : 0;
      const sortPath = parent
        ? `${pad4(sectionCounter)}.${pad4(itemCounter)}`
        : pad4(itemCounter);
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
      stats.items++;
      continue;
    }
  }
  return { tree, stats };
}

/**
 * 把 .xlsx 的 ArrayBuffer 解析成最佳工作表的 ParseResult。
 *
 * 多 sheet 的處理：每個 sheet 跑一次 auto-detect parser，按下列分數挑最好的：
 *   item 數 × 100 + (有 name) × 50 + (有 location) × 30 + (有 client) × 10
 * 例：報價單檔案有「公司報價單」和「廠商報價單」兩 sheet,廠商版有完整 工地名稱／工程地點／客戶名稱,
 * 會勝過公司版只有「姓名」的版本。
 */
export function parseTenderArrayBuffer(buf: ArrayBuffer): ParseResult & {
  sheetName: string;
  format: SheetFormat;
} {
  const wb = XLSX.read(buf, { type: "array", cellDates: true, cellNF: false });

  let best: { sheetName: string; result: ParseResult; format: SheetFormat; score: number } | null =
    null;
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: true,
      blankrows: true,
    });
    const format = detectFormat(matrix);
    const result = format === "quote" ? parseQuoteSheet(matrix) : parseTenderMatrix(matrix);
    const score =
      result.stats.items * 100 +
      (result.header.name ? 50 : 0) +
      (result.header.location ? 30 : 0) +
      (result.header.client ? 10 : 0);
    if (!best || score > best.score) best = { sheetName: name, result, format, score };
  }

  if (!best) {
    const sheetName = wb.SheetNames[0] ?? "Sheet1";
    return {
      rows: [],
      tree: [],
      header: { name: null, location: null, code: null, client: null },
      stats: { rows: 0, sections: 0, items: 0, specs: 0, skipped: 0 },
      warnings: [{ row: 0, msg: "檔案無 sheet" }],
      sheetName,
      format: "tender",
    };
  }
  return { ...best.result, sheetName: best.sheetName, format: best.format };
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
