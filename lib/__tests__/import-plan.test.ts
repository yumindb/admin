import { describe, expect, it } from "vitest";
import {
  offsetSortPath,
  planUndoImport,
  rootSegment,
  type UndoRow,
} from "../import-plan";

describe("rootSegment", () => {
  it("取第一段數值", () => {
    expect(rootSegment("0003.0012.0001")).toBe(3);
    expect(rootSegment("0001")).toBe(1);
  });
  it("解析失敗回 0", () => {
    expect(rootSegment("")).toBe(0);
    expect(rootSegment("abc.0001")).toBe(0);
  });
});

describe("offsetSortPath", () => {
  it("只位移第一段,其餘不動", () => {
    expect(offsetSortPath("0001.0002.0003", 7)).toBe("0008.0002.0003");
    expect(offsetSortPath("0002", 5)).toBe("0007");
  });
  it("base <= 0 不變", () => {
    expect(offsetSortPath("0001.0002", 0)).toBe("0001.0002");
  });
  it("位移後維持字典序(附加樹排在既有樹後面)", () => {
    const existingMax = "0007.0011";
    const appended = offsetSortPath("0001.0001", 7);
    expect(appended > existingMax).toBe(true);
  });
});

describe("planUndoImport", () => {
  const IMP = "imp-new";
  const OLD = "imp-old";
  const row = (
    id: string,
    parent: string | null,
    importId: string | null,
    modified = false,
  ): UndoRow => ({
    id,
    parent_id: parent,
    import_id: importId,
    modified_by_user: modified,
  });

  it("整批乾淨匯入 → 全部可刪", () => {
    const rows = [
      row("s1", null, IMP),
      row("a", "s1", IMP),
      row("b", "s1", IMP),
    ];
    const plan = planUndoImport(rows, IMP, new Set());
    expect(plan.deletableIds.sort()).toEqual(["a", "b", "s1"]);
    expect(plan.keptModified + plan.keptReferenced + plan.keptAsParent).toBe(0);
  });

  it("不刪別批匯入的列(合併匯入後撤銷不能動到原有工項)", () => {
    const rows = [
      row("old-s", null, OLD),
      row("old-a", "old-s", OLD),
      row("new-s", null, IMP),
      row("new-a", "new-s", IMP),
    ];
    const plan = planUndoImport(rows, IMP, new Set());
    expect(plan.deletableIds.sort()).toEqual(["new-a", "new-s"]);
  });

  it("手動修改過的保留,其分類層也保留(cascade 防護)", () => {
    const rows = [
      row("s1", null, IMP),
      row("a", "s1", IMP, true), // 手動修改
      row("b", "s1", IMP),
    ];
    const plan = planUndoImport(rows, IMP, new Set());
    expect(plan.deletableIds).toEqual(["b"]);
    expect(plan.keptModified).toBe(1);
    expect(plan.keptAsParent).toBe(1); // s1
  });

  it("日誌引用的保留,連同祖先分類層", () => {
    const rows = [
      row("s1", null, IMP),
      row("i1", "s1", IMP),
      row("spec1", "i1", IMP),
      row("i2", "s1", IMP),
    ];
    const plan = planUndoImport(rows, IMP, new Set(["spec1"]));
    expect(plan.deletableIds).toEqual(["i2"]);
    expect(plan.keptReferenced).toBe(1); // spec1
    expect(plan.keptAsParent).toBe(2); // s1, i1
  });

  it("此批分類層底下掛著別批/手動子項時,分類層保留", () => {
    const rows = [
      row("s1", null, IMP),
      row("a", "s1", IMP),
      row("manual", "s1", null), // 手動新增,import_id null
    ];
    const plan = planUndoImport(rows, IMP, new Set());
    expect(plan.deletableIds).toEqual(["a"]);
    expect(plan.keptAsParent).toBe(1);
  });

  it("資料成環時保守全保留,不會無限迴圈", () => {
    const rows = [row("x", "y", IMP), row("y", "x", IMP)];
    const plan = planUndoImport(rows, IMP, new Set());
    expect(plan.deletableIds).toEqual([]);
  });
});
