import { describe, it, expect } from "vitest";
import {
  groupWorkItemsByAncestor,
  type WorkItemNode,
} from "../work-item-grouping";

/**
 * 重點在「輸出順序照標單項次(sort_path),不是主任勾選順序」—
 * 日誌詳情、簽核頁、核定 PDF 三處共用這個函式。
 */

type Picked = { work_item_id: string };

function node(
  id: string,
  sort_path: string | null,
  opts: Partial<WorkItemNode> = {}
): WorkItemNode {
  return {
    id,
    parent_id: null,
    item_type: "item",
    tender_code: null,
    name: id,
    unit: null,
    sort_path,
    ...opts,
  };
}

function makeMap(nodes: WorkItemNode[]) {
  return new Map(nodes.map((n) => [n.id, n]));
}

const ids = (groups: { items: Picked[] }[]) =>
  groups.flatMap((g) => g.items.map((i) => i.work_item_id));

describe("groupWorkItemsByAncestor 排序", () => {
  it("勾選順序打亂時仍照 sort_path 輸出", () => {
    const map = makeMap([
      node("a", "0001"),
      node("b", "0002"),
      node("c", "0003"),
    ]);
    // 主任勾的順序:c → a → b
    const picked: Picked[] = [
      { work_item_id: "c" },
      { work_item_id: "a" },
      { work_item_id: "b" },
    ];
    const groups = groupWorkItemsByAncestor(picked, (p) => p.work_item_id, map);
    expect(ids(groups)).toEqual(["a", "b", "c"]);
  });

  it("spec 併到同一個 ancestor 底下,組內也照 sort_path", () => {
    const map = makeMap([
      node("parent", "0002"),
      node("s2", "0002.0002", { item_type: "spec", parent_id: "parent" }),
      node("s1", "0002.0001", { item_type: "spec", parent_id: "parent" }),
      node("other", "0001"),
    ]);
    const picked: Picked[] = [
      { work_item_id: "s2" },
      { work_item_id: "other" },
      { work_item_id: "s1" },
    ];
    const groups = groupWorkItemsByAncestor(picked, (p) => p.work_item_id, map);
    // other(0001)整組排在 parent(0002)之前;parent 組內 s1 先於 s2
    expect(ids(groups)).toEqual(["other", "s1", "s2"]);
    expect(groups[1].groupId).toBe("parent");
    expect(groups[1].items).toHaveLength(2);
  });

  it("zero-padded 字串比大小,10 不會排在 2 前面", () => {
    const map = makeMap([
      node("x", "0010"),
      node("y", "0002"),
    ]);
    const picked: Picked[] = [{ work_item_id: "x" }, { work_item_id: "y" }];
    const groups = groupWorkItemsByAncestor(picked, (p) => p.work_item_id, map);
    expect(ids(groups)).toEqual(["y", "x"]);
  });

  it("查不到節點的工項(已被刪除)排在最後,不影響其他項", () => {
    const map = makeMap([node("a", "0001"), node("b", "0002")]);
    const picked: Picked[] = [
      { work_item_id: "ghost" },
      { work_item_id: "b" },
      { work_item_id: "a" },
    ];
    const groups = groupWorkItemsByAncestor(picked, (p) => p.work_item_id, map);
    expect(ids(groups)).toEqual(["a", "b", "ghost"]);
  });

  it("sort_path 為 null 時不會炸,排在有值的後面", () => {
    const map = makeMap([node("a", null), node("b", "0001")]);
    const picked: Picked[] = [{ work_item_id: "a" }, { work_item_id: "b" }];
    const groups = groupWorkItemsByAncestor(picked, (p) => p.work_item_id, map);
    expect(ids(groups)).toEqual(["b", "a"]);
  });
});
