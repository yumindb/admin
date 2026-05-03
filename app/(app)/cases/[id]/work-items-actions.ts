"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { wrapDbError } from "@/lib/db/wrap-error";
import type { QuoteStatus } from "@/lib/types";

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

    // 合約外/未簽約 編輯時自動更新 quote_status:有單價 → quoted,沒有 → pending
    const isExtraOrUnsigned =
      row.item_type === "extra" || row.item_type === "unsigned";
    const quoteStatus: QuoteStatus | undefined = isExtraOrUnsigned
      ? data.unit_price !== null
        ? "quoted"
        : "pending"
      : undefined;

    const updatePayload: Record<string, unknown> = {
      name: data.name,
      unit: data.unit,
      quantity: data.quantity,
      unit_price: data.unit_price,
      total_price: totalPrice,
      brand_note: data.brand_note,
      modified_by_user: true,
    };
    if (quoteStatus !== undefined) updatePayload.quote_status = quoteStatus;

    const { error } = await supabase
      .from("case_work_items")
      .update(updatePayload)
      .eq("id", data.work_item_id);
    if (error) throw wrapDbError(error, "更新工項失敗");

    revalidatePath(`/cases/${row.case_id as string}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

// ==========================================================================
// 合約外 / 未簽約 — 案件級工項 (item_type IN ('extra','unsigned'))
// ==========================================================================
// 規則:
//  - 三種角色都可新增(site_supervisor 在現場填日誌時、office_staff/owner 在案件總覽)
//  - 編輯/刪除 沿用上面的 update/delete action(會走 office_staff/owner 檢查)
//  - 由日誌填寫時即時新增 → 仍歸到案件級表(下次日誌可繼續勾)
//  - sort_path 自動排在同類型最末 (root 層;不歸屬任何 section)

const ExtraUnsignedKindSchema = z.enum(["extra", "unsigned"]);

const CreateExtraUnsignedSchema = z.object({
  case_id: z.string().uuid(),
  kind: ExtraUnsignedKindSchema,
  name: z.string().trim().min(1, "名稱必填").max(500),
  unit: z.string().trim().max(40).nullable(),
  quantity: NumberLike,
  unit_price: NumberLike,
  brand_note: z.string().trim().max(500).nullable(),
});

export type CreateExtraUnsignedResult =
  | { ok: true; workItemId: string }
  | { ok: false; error: string };

/**
 * 新增合約外或未簽約工項。
 *
 * 任三種角色(site_supervisor / office_staff / owner)都可呼叫:
 *  - 工地主任在 /logs/new 填單時 + 點「新增臨時項」,流程內帶入 case_id + kind
 *  - 辦公室助理 / 老闆在 /cases/[id] 案件總覽,直接點「新增合約外/未簽約」
 *
 * 回傳新工項的 id,讓呼叫端可以立刻把它放進日誌的 work_items picker。
 */
export async function createExtraOrUnsignedAction(
  formData: FormData,
): Promise<CreateExtraUnsignedResult> {
  try {
    await requireRole(["site_supervisor", "office_staff", "owner"]);

    const parsed = CreateExtraUnsignedSchema.safeParse({
      case_id: String(formData.get("case_id") ?? ""),
      kind: String(formData.get("kind") ?? ""),
      name: String(formData.get("name") ?? ""),
      unit: (formData.get("unit") as string) || null,
      quantity: (formData.get("quantity") as string) || null,
      unit_price: (formData.get("unit_price") as string) || null,
      brand_note: (formData.get("brand_note") as string) || null,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message ?? "資料格式錯誤";
      return { ok: false, error: first };
    }
    const data = parsed.data;

    const { sortPath, depth } = await computeSortPath(data.case_id, null);

    const totalPrice =
      data.quantity !== null && data.unit_price !== null
        ? Number((data.quantity * data.unit_price).toFixed(2))
        : null;
    const quoteStatus: QuoteStatus =
      data.unit_price !== null ? "quoted" : "pending";

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: inserted, error } = await supabase
      .from("case_work_items")
      .insert({
        case_id: data.case_id,
        parent_id: null,
        sort_path: sortPath,
        depth,
        item_type: data.kind,
        tender_code: null,
        name: data.name,
        unit: data.unit,
        quantity: data.quantity,
        unit_price: data.unit_price,
        total_price: totalPrice,
        brand_note: data.brand_note,
        modified_by_user: true,
        quote_status: quoteStatus,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[createExtraOrUnsignedAction] insert failed", error);
      // POC 階段把真正的 DB 錯誤訊息直接吐給 client,方便 Phil 自己 debug
      // (正式版改回 wrapDbError 隱藏 internal details)
      return { ok: false, error: `新增工項失敗:${error.message}` };
    }

    revalidatePath(`/cases/${data.case_id}`);
    return { ok: true, workItemId: inserted.id as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "新增失敗" };
  }
}

const MarkAsSignedSchema = z.object({
  work_item_id: z.string().uuid(),
  contract_note: z.string().trim().min(1, "簽約備註必填").max(500),
});

/**
 * 把未簽約工項標記為已簽約 → 變更 item_type 'unsigned' → 'extra'。
 * 要求:單價已填(quote_status='quoted')+ 必填一行簽約備註。
 * 寫入 contract_signed_at = now(),contract_note = 備註。
 */
export async function markUnsignedAsSignedAction(
  formData: FormData,
): Promise<WorkItemActionResult> {
  try {
    await requireRole(["office_staff", "owner"]);

    const parsed = MarkAsSignedSchema.safeParse({
      work_item_id: String(formData.get("work_item_id") ?? ""),
      contract_note: String(formData.get("contract_note") ?? ""),
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message ?? "資料格式錯誤";
      return { ok: false, error: first };
    }
    const { work_item_id, contract_note } = parsed.data;

    const supabase = await createClient();

    const { data: row, error: readErr } = await supabase
      .from("case_work_items")
      .select("id, case_id, item_type, unit_price")
      .eq("id", work_item_id)
      .maybeSingle();
    if (readErr) throw wrapDbError(readErr, "讀取工項失敗");
    if (!row) return { ok: false, error: "找不到此工項" };
    if (row.item_type !== "unsigned") {
      return { ok: false, error: "只有未簽約項目可以標記為已簽約" };
    }
    if (row.unit_price === null || row.unit_price === undefined) {
      return { ok: false, error: "請先填寫單價(報價)後再標記簽約" };
    }

    const { error } = await supabase
      .from("case_work_items")
      .update({
        item_type: "extra",
        contract_signed_at: new Date().toISOString(),
        contract_note,
        quote_status: "quoted",
        modified_by_user: true,
      })
      .eq("id", work_item_id);
    if (error) throw wrapDbError(error, "標記簽約失敗");

    revalidatePath(`/cases/${row.case_id as string}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "標記失敗" };
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
