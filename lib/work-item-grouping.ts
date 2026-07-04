/**
 * 把日誌已勾選的工項依「最近的非 spec 祖先」分組,顯示時可帶出大項目名稱。
 * 例:1/2"(E19) / 3/4"(E25) 都是 spec → 統一歸到上層的 PVC電管(item) 之下。
 */
import type { WorkItemType } from "./types";

export type WorkItemNode = {
  id: string;
  parent_id: string | null;
  item_type: WorkItemType;
  tender_code: string | null;
  name: string;
  unit: string | null;
};

export type WorkItemGroup<T> = {
  /** 群組 = 這個 ancestor。null 表示找不到祖先(資料缺) */
  groupId: string | null;
  groupName: string | null;
  groupTenderCode: string | null;
  /** true 時整組只是該 ancestor 自己一筆,渲染時可省略 group header */
  selfOnly: boolean;
  items: T[];
};

/**
 * spec 類型的 row 會往上找到第一個非 spec 的祖先當 group。
 * item / section / manual 類型的 row 直接以自己為 group(selfOnly=true,UI 可選擇不畫 header)。
 */
export function groupWorkItemsByAncestor<T>(
  selected: T[],
  getId: (t: T) => string,
  nodeMap: Map<string, WorkItemNode>
): WorkItemGroup<T>[] {
  const groups = new Map<string, WorkItemGroup<T>>();
  const order: string[] = [];

  for (const sel of selected) {
    const id = getId(sel);
    const node = nodeMap.get(id);

    let groupNode: WorkItemNode | null = null;
    let selfOnly = false;

    if (node) {
      if (node.item_type === "spec") {
        let cur: WorkItemNode | null = node.parent_id
          ? nodeMap.get(node.parent_id) ?? null
          : null;
        while (cur && cur.item_type === "spec") {
          cur = cur.parent_id ? nodeMap.get(cur.parent_id) ?? null : null;
        }
        groupNode = cur;
      } else {
        groupNode = node;
        selfOnly = true;
      }
    }

    const key = groupNode?.id ?? "__orphan__";
    let g = groups.get(key);
    if (!g) {
      g = {
        groupId: groupNode?.id ?? null,
        groupName: groupNode?.name ?? null,
        groupTenderCode: groupNode?.tender_code ?? null,
        selfOnly,
        items: [],
      };
      groups.set(key, g);
      order.push(key);
    } else {
      g.selfOnly = false;
    }
    g.items.push(sel);
  }

  return order.map((k) => groups.get(k)!);
}

/**
 * 從 Supabase 讀工項時 helper:給定一組葉節點 id,逐層往上抓 parent
 * 直到所有祖先都拿到。回傳 id → node 的 Map。
 *
 * `client` 接 Supabase client(typed 太重,這裡用 any 避免 instantiation 過深)。
 */
export async function fetchWorkItemAncestry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  leafIds: string[]
): Promise<Map<string, WorkItemNode>> {
  const nodes = new Map<string, WorkItemNode>();
  if (!leafIds.length) return nodes;

  const seen = new Set<string>(leafIds);
  let pending = leafIds;
  while (pending.length) {
    const { data } = await client
      .from("case_work_items")
      .select("id, parent_id, item_type, tender_code, name, unit")
      .in("id", pending);
    const rows = (data ?? []) as WorkItemNode[];
    const next: string[] = [];
    for (const r of rows) {
      nodes.set(r.id, r);
      if (r.parent_id && !seen.has(r.parent_id)) {
        seen.add(r.parent_id);
        next.push(r.parent_id);
      }
    }
    pending = next;
  }
  return nodes;
}
