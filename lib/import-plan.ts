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
