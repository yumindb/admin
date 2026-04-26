"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ParsedNode } from "@/lib/tender-parser";

/**
 * 確認匯入：把 client 傳上來的扁平化節點寫進 case_work_items + tender_imports。
 *
 * 重複匯入合併規則：
 *   - 已存在 (case_id, tender_code, name) 且 modified_by_user = true → skip
 *   - 已存在且未修改 → update（quantity / unit / unit_price / total_price / brand_note / import_id）
 *   - 不存在 → insert
 *
 * parent_id 透過 sortPath 在 server-side 重建（client 用的暫時 id 在 server-side 重新生成）。
 */

type IncomingNode = Pick<
  ParsedNode,
  | "id"
  | "depth"
  | "sortPath"
  | "parentId"
  | "type"
  | "tenderCode"
  | "name"
  | "unit"
  | "quantity"
  | "unitPrice"
  | "totalPrice"
  | "brandNote"
  | "specText"
  | "skippedByUser"
>;

type ConfirmPayload = {
  caseId: string;
  fileName: string;
  nodes: IncomingNode[];
  stats: { rows: number; sections: number; items: number; specs: number; skipped: number };
  warnings: { row: number; msg: string }[];
};

export async function confirmImportAction(payload: ConfirmPayload) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登入" };

  // 1) 寫 tender_imports
  const { data: imp, error: impErr } = await supabase
    .from("tender_imports")
    .insert({
      case_id: payload.caseId,
      file_name: payload.fileName,
      status: "imported",
      parse_stats: payload.stats,
      warnings: payload.warnings,
      imported_by: user.id,
    })
    .select("id")
    .single();

  if (impErr || !imp) return { ok: false, error: "匯入記錄寫入失敗：" + impErr?.message };
  const importId = imp.id as string;

  // 2) 撈現有 work items 做 dedupe — 必須限定當前 case,否則跨案匯入會把
  //    新案的工項 parent_id 接到舊案的 row 上(bug fixed 2026-04-26)
  const { data: existing, error: existErr } = await supabase
    .from("case_work_items")
    .select("id, tender_code, name, modified_by_user")
    .eq("case_id", payload.caseId);
  if (existErr) return { ok: false, error: "讀取現有工項失敗：" + existErr.message };

  const dedupeKey = (code: string | null, name: string) => `${code ?? ""}|${name}`;
  const existingMap = new Map<string, { id: string; modified: boolean }>();
  for (const e of existing ?? []) {
    existingMap.set(dedupeKey(e.tender_code as string | null, e.name as string), {
      id: e.id as string,
      modified: !!e.modified_by_user,
    });
  }

  // 3) 過濾使用者勾「略過」的 → 不寫入但記入 skipped_count
  const usable = payload.nodes.filter((n) => !n.skippedByUser && n.type !== "skip");
  let importedCount = 0;
  let updatedCount = 0;
  const skippedFromUI = payload.nodes.filter((n) => n.skippedByUser).length;

  // 4) 兩段式 insert：先 insert root（無 parent）→ 拿到 server id → 再 insert children
  //    用一個 mapping: clientId → serverId
  const idMap = new Map<string, string>();
  // 把 nodes 依 sortPath 排序，確保 parent 在前
  const sorted = [...usable].sort((a, b) => a.sortPath.localeCompare(b.sortPath));

  for (const n of sorted) {
    const itemType = n.type === "section" ? "section" : n.type === "spec" ? "spec" : "item";
    const key = dedupeKey(n.tenderCode, n.name);
    const dup = existingMap.get(key);

    const parentServerId = n.parentId ? idMap.get(n.parentId) ?? null : null;

    if (dup) {
      if (dup.modified) {
        // 保留使用者修改，但仍把 client→server id 記下供子項用
        idMap.set(n.id, dup.id);
        continue;
      }
      const { error } = await supabase
        .from("case_work_items")
        .update({
          unit: n.unit,
          quantity: n.quantity,
          unit_price: n.unitPrice,
          total_price: n.totalPrice,
          brand_note: n.brandNote,
          spec_text: n.specText,
          import_id: importId,
          parent_id: parentServerId,
          sort_path: n.sortPath,
          depth: n.depth,
          item_type: itemType,
        })
        .eq("id", dup.id);
      if (error) return { ok: false, error: "更新工項失敗：" + error.message };
      idMap.set(n.id, dup.id);
      updatedCount++;
    } else {
      const { data: inserted, error } = await supabase
        .from("case_work_items")
        .insert({
          case_id: payload.caseId,
          parent_id: parentServerId,
          sort_path: n.sortPath,
          depth: n.depth,
          item_type: itemType,
          tender_code: n.tenderCode,
          name: n.name,
          unit: n.unit,
          quantity: n.quantity,
          unit_price: n.unitPrice,
          total_price: n.totalPrice,
          brand_note: n.brandNote,
          spec_text: n.specText,
          import_id: importId,
        })
        .select("id")
        .single();
      if (error || !inserted) return { ok: false, error: "新增工項失敗：" + error?.message };
      idMap.set(n.id, inserted.id as string);
      importedCount++;
    }
  }

  // 5) 更新 tender_imports.imported_count / skipped_count
  await supabase
    .from("tender_imports")
    .update({
      imported_count: importedCount + updatedCount,
      skipped_count: skippedFromUI,
    })
    .eq("id", importId);

  revalidatePath(`/cases/${payload.caseId}`);
  return { ok: true, importedCount, updatedCount, skippedFromUI };
}

export async function redirectAfterImport(caseId: string) {
  redirect(`/cases/${caseId}`);
}

/**
 * 撤銷某次匯入：刪除 case_work_items 中 import_id = importId 且 modified_by_user = false 的項目。
 * 已被使用者修改過的項目保留（避免誤刪手動調整）。tender_imports 那筆 row 也刪掉。
 */
export async function undoImportAction(formData: FormData) {
  const caseId = String(formData.get("caseId") ?? "");
  const importId = String(formData.get("importId") ?? "");
  if (!caseId || !importId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("case_work_items")
    .delete()
    .eq("case_id", caseId)
    .eq("import_id", importId)
    .eq("modified_by_user", false);

  await supabase.from("tender_imports").delete().eq("id", importId);

  revalidatePath(`/cases/${caseId}`);
  redirect(`/cases/${caseId}`);
}
