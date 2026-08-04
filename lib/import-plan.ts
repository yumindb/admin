/**
 * 標單匯入的純邏輯 helpers(不碰 DB,方便單元測試)。
 *
 * 背景(2026-08-03 業主回報):
 *   - 同一案件常需要匯入第二份標單(追加、分包)。舊版只有「合併」一種模式,
 *     不同檔案撞名的工項會被覆蓋+改掛到新樹底下 → 看起來像「原本的資料被洗掉」。
 *   - 撤銷匯入用 import_id 整批刪,但合併時既有列的 import_id 被改成新匯入,
 *     一撤銷連原本的工項也刪掉;日誌引用處全部變「(已刪除工項)」。
 *
 * 對策:
 *   - 附加模式:全部當新列插入,sort_path 第一段整批位移到既有樹之後(offsetSortPath)。
 *   - 撤銷:用 planUndoImport 算出「安全刪除集」— 手動修改過、日誌已引用、
 *     或底下還有要保留子孫的列一律不刪(parent_id FK 是 ON DELETE CASCADE,
 *     刪了分類層會把要保留的子項一起帶走)。
 */

/** sort_path 第一段(root 區段)的數值,e.g. "0003.0012" → 3。解析失敗回 0。 */
export function rootSegment(sortPath: string): number {
  const n = parseInt(sortPath.split(".")[0] ?? "", 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 把 sort_path 的第一段加上位移量,維持 zero-pad 4 位。
 * 附加匯入時 base = 既有樹最大 root 段,讓新樹整批排在後面。
 */
export function offsetSortPath(sortPath: string, base: number): string {
  if (base <= 0) return sortPath;
  const segs = sortPath.split(".");
  const first = parseInt(segs[0] ?? "", 10);
  if (!Number.isFinite(first)) return sortPath;
  segs[0] = String(first + base).padStart(4, "0");
  return segs.join(".");
}

export type MergeKeyNode = {
  id: string;
  parentId: string | null;
  tenderCode: string | null;
  name: string;
  sortPath: string;
};

/**
 * 合併匯入的比對鍵 —「從 root 到自己的 (項次代號|名稱) 路徑」+ 同層同鍵的出現序號。
 *
 * 為什麼不能只用 (tender_code, name)（2026-08-04 業主案件 YM-2026-001 少列的根因）：
 *   機電標單每個配電盤底下都有一模一樣的 `-3 | D-FUSE 500V 2A W/BASE`、
 *   `-10 | PVC WIRE&五金另料&壓克力銘牌`。只比對代號+名稱，「藥局盤的 D-FUSE」會撞上
 *   「K1 盤的 D-FUSE」，後面章節那幾列被判成重複而跳過 → 標單短少、日誌引用接到別的盤，
 *   撤銷匯入時還會把別人的列一起算進來。父層自己也可能同名（該案有兩個 "E1L" PANEL，
 *   靠項次代號 8 / 10 才分得開），所以路徑每一層都要帶項次代號。
 *
 * 序號的用途：檔案裡真的有兩列同層同名同代號時（該案 0027.0001「PVC 電線 2.0mm」就有兩份），
 *   不加序號第二列會永遠被判成第一列的重複而消失。
 *
 * ⚠ 兩邊必須用「同一個母體」建鍵才對得起來：DB 端傳整案的列，解析端傳「實際會寫進 DB 的
 *   節點」(usable)。把使用者勾略過的節點混進來會讓序號錯位，重匯就變成重複插入。
 */
export function buildMergeKeys(nodes: MergeKeyNode[]): Map<string, string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, string>();
  const visiting = new Set<string>();
  const own = (n: MergeKeyNode) => `${n.tenderCode ?? ""}|${n.name}`;

  function path(n: MergeKeyNode): string {
    const hit = memo.get(n.id);
    if (hit !== undefined) return hit;
    if (visiting.has(n.id)) return own(n); // 資料異常成環:退回只用自己這層
    visiting.add(n.id);
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const full = parent ? `${path(parent)} / ${own(n)}` : own(n);
    visiting.delete(n.id);
    memo.set(n.id, full);
    return full;
  }

  // 依 sortPath 排序,讓「同層第幾個」在 DB 端與解析端算出同一個序號
  const ordered = [...nodes].sort((a, b) => a.sortPath.localeCompare(b.sortPath));
  const seen = new Map<string, number>();
  const keys = new Map<string, string>();
  for (const n of ordered) {
    const p = path(n);
    const i = seen.get(p) ?? 0;
    seen.set(p, i + 1);
    keys.set(n.id, `${p}#${i}`);
  }
  return keys;
}

export type UndoRow = {
  id: string;
  parent_id: string | null;
  import_id: string | null;
  modified_by_user: boolean;
};

export type UndoPlan = {
  /** 可以安全刪除的 id(含分類層;保證不會 cascade 到任何要保留的列) */
  deletableIds: string[];
  /** 此次匯入但因日誌已引用而保留 */
  keptReferenced: number;
  /** 此次匯入但因手動修改過而保留 */
  keptModified: number;
  /** 此次匯入的分類層,因底下還有要保留的項目而一併保留 */
  keptAsParent: number;
};

/**
 * 算撤銷匯入的安全刪除集:一列可刪 ⇔
 *   屬於此次匯入 && 未被手動修改 && 未被日誌引用 && 所有子孫都可刪。
 */
export function planUndoImport(
  rows: UndoRow[],
  importId: string,
  referencedIds: Set<string>,
): UndoPlan {
  const childMap = new Map<string, UndoRow[]>();
  for (const r of rows) {
    if (!r.parent_id) continue;
    const arr = childMap.get(r.parent_id) ?? [];
    arr.push(r);
    childMap.set(r.parent_id, arr);
  }

  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();

  function deletable(r: UndoRow): boolean {
    const hit = memo.get(r.id);
    if (hit !== undefined) return hit;
    if (visiting.has(r.id)) return false; // 資料異常成環時保守保留
    visiting.add(r.id);
    let kidsAllDeletable = true;
    for (const k of childMap.get(r.id) ?? []) {
      if (!deletable(k)) kidsAllDeletable = false;
    }
    visiting.delete(r.id);
    const own =
      r.import_id === importId &&
      !r.modified_by_user &&
      !referencedIds.has(r.id);
    const d = own && kidsAllDeletable;
    memo.set(r.id, d);
    return d;
  }

  const plan: UndoPlan = {
    deletableIds: [],
    keptReferenced: 0,
    keptModified: 0,
    keptAsParent: 0,
  };
  for (const r of rows) {
    if (deletable(r)) {
      plan.deletableIds.push(r.id);
    } else if (r.import_id === importId) {
      if (referencedIds.has(r.id)) plan.keptReferenced++;
      else if (r.modified_by_user) plan.keptModified++;
      else plan.keptAsParent++;
    }
  }
  return plan;
}
