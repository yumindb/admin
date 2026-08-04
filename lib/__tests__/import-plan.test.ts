import { describe, expect, it } from "vitest";
import {
  buildMergeKeys,
  offsetSortPath,
  planUndoImport,
  rootSegment,
  type MergeKeyNode,
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

describe("buildMergeKeys", () => {
  const n = (
    id: string,
    parentId: string | null,
    tenderCode: string | null,
    name: string,
    sortPath: string,
  ): MergeKeyNode => ({ id, parentId, tenderCode, name, sortPath });

  it("跨章節同名同代號不再互撞 — 各自帶章節路徑", () => {
    // 真實機電標單:每個配電盤底下都有一模一樣的 `-3 | D-FUSE`
    const keys = buildMergeKeys([
      n("k1", null, "3", '"K1" PANEL', "0008"),
      n("k1-dfuse", "k1", "-3", "D-FUSE 500V 2A W/BASE", "0008.0003"),
      n("ph", null, "5", '"藥局" PANEL', "0010"),
      n("ph-dfuse", "ph", "-3", "D-FUSE 500V 2A W/BASE", "0010.0003"),
    ]);
    expect(keys.get("k1-dfuse")).not.toBe(keys.get("ph-dfuse"));
    expect(keys.get("k1-dfuse")).toBe('3|"K1" PANEL / -3|D-FUSE 500V 2A W/BASE#0');
  });

  it("父層同名時靠父層項次代號分開(該案有兩個 \"E1L\" PANEL)", () => {
    const keys = buildMergeKeys([
      n("e1", null, "8", '"E1L" PANEL', "0014"),
      n("e1-mccb", "e1", "-3", "MCCB 3P 100AF", "0014.0003"),
      n("e2", null, "10", '"E1L" PANEL', "0016"),
      n("e2-mccb", "e2", "-3", "MCCB 3P 100AF", "0016.0003"),
    ]);
    expect(keys.get("e1-mccb")).not.toBe(keys.get("e2-mccb"));
  });

  it("同層真的有兩列一模一樣時,用序號分開(第二列不會被吃掉)", () => {
    const keys = buildMergeKeys([
      n("s", null, "7", "PVC 電線 & XLPE CABLE", "0027"),
      n("a", "s", "-1", "PVC 電線 2.0mm", "0027.0001"),
      n("b", "s", "-1", "PVC 電線 2.0mm", "0027.0001"),
    ]);
    expect(keys.get("a")).toMatch(/#0$/);
    expect(keys.get("b")).toMatch(/#1$/);
  });

  it("DB 端與解析端母體一致時,鍵可以對上(重匯同一份 = 全部命中)", () => {
    const tree = (prefix: string) => [
      n(`${prefix}s`, null, "一", "高低壓配電盤", "0003"),
      n(`${prefix}a`, `${prefix}s`, "-1", "CASE：", "0003.0001"),
      n(`${prefix}b`, `${prefix}s`, "-2", "MCCB", "0003.0002"),
    ];
    const dbKeys = [...buildMergeKeys(tree("db")).values()].sort();
    const fileKeys = [...buildMergeKeys(tree("file")).values()].sort();
    expect(fileKeys).toEqual(dbKeys);
  });

  it("父層被略過(不在母體內)時當成 root,不會炸掉", () => {
    const keys = buildMergeKeys([n("orphan", "gone", "-1", "孤兒項", "0005.0001")]);
    expect(keys.get("orphan")).toBe("-1|孤兒項#0");
  });

  it("資料成環時不會無限迴圈", () => {
    const keys = buildMergeKeys([
      n("x", "y", "1", "X", "0001"),
      n("y", "x", "2", "Y", "0002"),
    ]);
    expect(keys.size).toBe(2);
  });
});
