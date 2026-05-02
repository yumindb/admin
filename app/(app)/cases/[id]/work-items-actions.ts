"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { wrapDbError } from "@/lib/db/wrap-error";

/**
 * 工項手動 CRUD — 解辦公室助理 P0 痛點 (audit E4)。
 *
 * 規則:
 *  - 僅 office_staff / owner 可操作
 *  - 不允許改 section (改名要走匯入邏輯,避免重複匯入後不一致)
 *  - 編輯 → 強制 modified_by_user = true,匯入時不會被覆蓋 (decisions 1.4)
 *  - 新增 → item_type = 'manual'、modified_by_user = true、sort_path 同 parent 內最大 +1
 *  - 刪除 → 警告 dangling reference 但仍刪;dangling 由 W4 後續清理 (TODO)
 */

const NumberLike = z
  .union([z.number(), z.string()])
  .transform((v) => {
    if (typeof v === "number") return v;
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  })
  .nullable();

const CreateSchema = z.object({
  case_id: z.string().uuid(),
  parent_id: z.string().uuid().nullable(),
  name: z.string().trim().min(1, "名稱必填").max(500),
  unit: z.string().trim().max(40).nullable(),
  quantity: NumberLike,
  unit_price: NumberLike,
  brand_note: z.string().trim().max(500).nullable(),
});

const UpdateSchema = z.object({
  work_item_id: z.string().uuid(),
  name: z.string().trim().min(1, "名稱必填").max(500),
  unit: z.string().trim().max(40).nullable(),
  quantity: NumberLike,
  unit_price: NumberLike,
  brand_note: z.string().trim().max(500).nullable(),
});

const DeleteSchema = z.object({
  work_item_id: z.string().uuid(),
});

export type WorkItemActionResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

/** 將同 parent 內最大 sort_path 末段 + 1,傳回新 sort_path 與 depth。 */
async function computeSortPath(
  caseId: string,
  parentId: string | null,
): Promise<{ sortPath: string; depth: number }> {
  const supabase = await createClient();

  // 取同 parent 的所有兄弟 sort_path,挑最大末段
  const q = supabase
    .from("case_work_items")
    .select("sort_path, depth")
    .eq("case_id", caseId)
    .order("sort_path", { ascending: false })
    .limit(1);
  const { data: siblings, error } = parentId
    ? await q.eq("parent_id", parentId)
    : await q.is("parent_id", null);
  if (error) throw wrapDbError(error, "讀取工項失敗");

  // 計算 parent prefix + depth
  let parentPrefix = "";
  let depth = 0;
  if (parentId) {
    const { data: parent, error: pErr } = await supabase
      .from("case_work_items")
      .select("sort_path, depth")
      .eq("id", parentId)
      .maybeSingle();
    if (pErr) throw wrapDbError(pErr, "讀取上層工項失敗");
    if (!parent) throw new Error("找不到上層工項");
    parentPrefix = `${parent.sort_path as string}.`;
    depth = (parent.depth as number) + 1;
  }

  // 從 siblings 末段抽號 (siblings 仍可能不在同層,因 sort_path desc 已限 parent_id)
  let nextSeq = 1;
  if (siblings && siblings.length > 0) {
    const sp = siblings[0].sort_path as string;
    const segs = sp.split(".");
    const last = parseInt(segs[segs.length - 1] ?? "0", 10);
    if (Number.isFinite(last)) nextSeq = last + 1;
  }
  const sortPath = `${parentPrefix}${String(nextSeq).padStart(4, "0")}`;
  return { sortPath, depth };
}

export async function createWorkItemAction(
  formData: FormData,
): Promise<WorkItemActionResult> {
  try {
    await requireRole(["office_staff", "owner"]);

    const parsed = CreateSchema.safeParse({
      case_id: String(formData.get("case_id") ?? ""),
      parent_id: (formData.get("parent_id") as string) || null,
      name: String(formData.get("name") ?? ""),
      unit: (formData.get("unit") as string) || null,
      quantity: (formData.get("quantity") as string) || null,
      unit_price: (formData.get("unit_price") as string) || null,
      brand_note: (formData.get("brand_note") as string) || null,
    });
    if (!parsed.success) {
      const first =
        parsed.error.issues[0]?.message ?? "資料格式錯誤";
      return { ok: false, error: first };
    }
    const data = parsed.data;

    // parent 必須屬於此 case (避免跨案污染)
    if (data.parent_id) {
      const supabase = await createClient();
      const { data: parent, error: pErr } = await supabase
        .from("case_work_items")
        .select("case_id, item_type")
        .eq("id", data.parent_id)
        .maybeSingle();
      if (pErr) throw wrapDbError(pErr, "讀取上層工項失敗");
      if (!parent || parent.case_id !== data.case_id) {
        return { ok: false, error: "找不到對應的上層分類" };
      }
    }

    const { sortPath, depth } = await computeSortPath(
      data.case_id,
      data.parent_id,
    );

    const totalPrice =
      data.quantity !== null && data.unit_price !== null
        ? Number((data.quantity * data.unit_price).toFixed(2))
        : null;

    const supabase = await createClient();
    const { error } = await supabase.from("case_work_items").insert({
      case_id: data.case_id,
      parent_id: data.parent_id,
      sort_path: sortPath,
      depth,
      item_type: "manual",
      tender_code: null,
      name: data.name,
      unit: data.unit,
      quantity: data.quantity,
      unit_price: data.unit_price,
      total_price: totalPrice,
      brand_note: data.brand_note,
      modified_by_user: true,
    });
    if (error) throw wrapDbError(error, "新增工項失敗");

    revalidatePath(`/cases/${data.case_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "新增失敗" };
  }
}

export async function updateWorkItemAction(
  formData: FormData,
): Promise<WorkItemActionResult> {
  try {
    await requireRole(["office_staff", "owner"]);

    const parsed = UpdateSchema.safeParse({
      work_item_id: String(formData.get("work_item_id") ?? ""),
      name: String(formData.get("name") ?? ""),
      unit: (formData.get("unit") as string) || null,
      quantity: (formData.get("quantity") as string) || null,
      unit_price: (formData.get("unit_price") as string) || null,
      brand_note: (formData.get("brand_note") as string) || null,
    });
    if (!parsed.success) {
      const first =
        parsed.error.issues[0]?.message ?? "資料格式錯誤";
      return { ok: false, error: first };
    }
    const data = parsed.data;

    const supabase = await createClient();

    // 先讀現況檢查 item_type — 不允許編輯 section
    const { data: row, error: readErr } = await supabase
      .from("case_work_items")
      .select("id, case_id, item_type")
      .eq("id", data.work_item_id)
      .maybeSingle();
    if (readErr) throw wrapDbError(readErr, "讀取工項失敗");
    if (!row) return { ok: false, error: "找不到此工項" };
    if (row.item_type === "section") {
      return {
        ok: false,
        error: "不允許編輯分類層（section）。請改名請走匯入流程。",
      };
    }

    const totalPrice =
      data.quantity !== null && data.unit_price !== null
        ? Number((data.quantity * data.unit_price).toFixed(2))
        : null;

    const { error } = await supabase
      .from("case_work_items")
      .update({
        name: data.name,
        unit: data.unit,
        quantity: data.quantity,
        unit_price: data.unit_price,
        total_price: totalPrice,
        brand_note: data.brand_note,
        modified_by_user: true,
      })
      .eq("id", data.work_item_id);
    if (error) throw wrapDbError(error, "更新工項失敗");

    revalidatePath(`/cases/${row.case_id as string}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

export async function deleteWorkItemAction(
  formData: FormData,
): Promise<WorkItemActionResult> {
  try {
    await requireRole(["office_staff", "owner"]);

    const parsed = DeleteSchema.safeParse({
      work_item_id: String(formData.get("work_item_id") ?? ""),
    });
    if (!parsed.success) return { ok: false, error: "資料格式錯誤" };
    const { work_item_id } = parsed.data;

    const supabase = await createClient();

    // 取 case_id 並蒐集子孫 ids (含自身) — 統計 dangling 用,實際刪除靠 ON DELETE CASCADE
    const { data: row, error: readErr } = await supabase
      .from("case_work_items")
      .select("id, case_id")
      .eq("id", work_item_id)
      .maybeSingle();
    if (readErr) throw wrapDbError(readErr, "讀取工項失敗");
    if (!row) return { ok: false, error: "找不到此工項" };
    const caseId = row.case_id as string;

    // 收集自己 + 所有後代 id (workaround,因為沒 recursive query helper)
    const allIds = new Set<string>([work_item_id]);
    const { data: caseItems, error: ciErr } = await supabase
      .from("case_work_items")
      .select("id, parent_id")
      .eq("case_id", caseId);
    if (ciErr) throw wrapDbError(ciErr, "讀取工項失敗");
    if (caseItems) {
      const childMap = new Map<string, string[]>();
      for (const it of caseItems) {
        const pid = (it.parent_id as string | null) ?? "__root__";
        const arr = childMap.get(pid) ?? [];
        arr.push(it.id as string);
        childMap.set(pid, arr);
      }
      const stack = [work_item_id];
      while (stack.length) {
        const cur = stack.pop()!;
        const kids = childMap.get(cur) ?? [];
        for (const k of kids) {
          if (!allIds.has(k)) {
            allIds.add(k);
            stack.push(k);
          }
        }
      }
    }

    // 統計 daily_logs.work_items jsonb 內有沒有引用要刪的 id
    // TODO (W4): dangling reference 後續清理 — 現在僅警告但允許刪除
    let danglingCount = 0;
    try {
      const idArr = Array.from(allIds);
      const { data: refLogs } = await supabase
        .from("daily_logs")
        .select("id, work_items")
        .eq("case_id", caseId);
      if (refLogs) {
        for (const log of refLogs) {
          const wis = (log.work_items as { work_item_id?: string }[] | null) ?? [];
          for (const w of wis) {
            if (w.work_item_id && idArr.includes(w.work_item_id)) {
              danglingCount += 1;
            }
          }
        }
      }
    } catch (refErr) {
      // 統計失敗不擋刪除
      console.warn("[deleteWorkItemAction] dangling check failed", refErr);
    }

    // ON DELETE CASCADE 會帶走子孫
    const { error } = await supabase
      .from("case_work_items")
      .delete()
      .eq("id", work_item_id);
    if (error) throw wrapDbError(error, "刪除工項失敗");

    revalidatePath(`/cases/${caseId}`);
    if (danglingCount > 0) {
      return {
        ok: true,
        warning: `已刪除。注意:有 ${danglingCount} 筆日誌記錄仍引用被刪除的工項,將顯示為「（已刪除）」,需後續清理。`,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}
