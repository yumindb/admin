"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/db/fetch-all";
import { requireRole } from "@/lib/auth/require-role";
import {
  offsetSortPath,
  planUndoImport,
  rootSegment,
  type UndoRow,
} from "@/lib/import-plan";
import type { ParsedNode } from "@/lib/tender-parser";

const UuidSchema = z.string().uuid();

/**
 * 確認匯入：把 client 傳上來的扁平化節點寫進 case_work_items + tender_imports。
 *
 * 兩種模式（2026-08-03 起,業主要求同案件可再匯第二份標單）：
 *   - append 附加：全部當新工項插入,sort_path root 段位移到既有樹之後,
 *     完全不動既有資料。匯「另一份標單」用這個（有工項時的預設）。
 *   - merge 合併更新：重新匯入「同一份」標單用,以 (case_id, tender_code, name) 比對：
 *       - 已存在且 modified_by_user = true → skip（保留使用者修改）
 *       - 已存在且未修改 → update（quantity / unit / unit_price / total_price / brand_note）
 *         ⚠ 不改 import_id — 改了會讓「撤銷此次匯入」把既有工項一起刪掉（2026-08-03 修）
 *       - 不存在 → insert
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

export type ImportMode = "append" | "merge";

type ConfirmPayload = {
  caseId: string;
  fileName: string;
  mode: ImportMode;
  nodes: IncomingNode[];
  stats: { rows: number; sections: number; items: number; specs: number; skipped: number };
  warnings: { row: number; msg: string }[];
};

export async function confirmImportAction(payload: ConfirmPayload) {
  const me = await requireRole(["office_staff", "owner"]);

  const parsedCaseId = UuidSchema.safeParse(payload.caseId);
  if (!parsedCaseId.success) {
    return { ok: false, error: "案件編號格式錯誤" };
  }

  const supabase = await createClient();

  // 1) 寫 tender_imports
  const { data: imp, error: impErr } = await supabase
    .from("tender_imports")
    .insert({
      case_id: payload.caseId,
      file_name: payload.fileName,
      status: "imported",
      parse_stats: payload.stats,
      warnings: payload.warnings,
      imported_by: me.id,
    })
    .select("id")
    .single();

  if (impErr || !imp) return { ok: false, error: "匯入記錄寫入失敗：" + impErr?.message };
  const importId = imp.id as string;

  // 2) 撈現有 work items 做 dedupe — 必須限定當前 case,否則跨案匯入會把
  //    新案的工項 parent_id 接到舊案的 row 上(bug fixed 2026-04-26)
  //    fetchAllRows:1000+ 項的案件重複匯入時,dedupe map 缺列會造成重複插入
  const { data: existing, error: existErr } = await fetchAllRows((from, to) =>
    supabase
      .from("case_work_items")
      .select("id, tender_code, name, modified_by_user")
      .eq("case_id", payload.caseId)
      .order("id", { ascending: true })
      .range(from, to),
  );
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
  // importedCount/updatedCount 只算「真正工項」(item + spec),不算 section 分類層 —
  // 案件詳情「最後匯入:新增 N 項」對應使用者眼中的工項數,而非 DB row 數
  let importedCount = 0;
  let updatedCount = 0;
  const skippedFromUI = payload.nodes.filter(
    (n) => n.skippedByUser && (n.type === "item" || n.type === "spec"),
  ).length;

  // 4) Batch insert/update — 一次 round-trip 寫入所有 nodes,避免 N+1 超 Vercel 10s。
  //    策略:server-side 先把 clientId → serverId map 完整建好(已存在用 dup.id;
  //    新項用 server-generated UUID),再依 (插入新項 + 更新現有未鎖項) 兩條 statement 寫入。
  const idMap = new Map<string, string>();
  // 把 nodes 依 sortPath 排序,確保 parent 在前(map 才能查到 parentServerId)
  const sorted = [...usable].sort((a, b) => a.sortPath.localeCompare(b.sortPath));

  type InsertRow = {
    id: string;
    case_id: string;
    parent_id: string | null;
    sort_path: string;
    depth: number;
    item_type: "section" | "item" | "spec";
    tender_code: string | null;
    name: string;
    unit: string | null;
    quantity: number | null;
    unit_price: number | null;
    total_price: number | null;
    brand_note: string | null;
    spec_text: string | null;
    import_id: string;
  };
  type UpdateRow = {
    id: string;
    parent_id: string | null;
    sort_path: string;
    depth: number;
    item_type: "section" | "item" | "spec";
    unit: string | null;
    quantity: number | null;
    unit_price: number | null;
    total_price: number | null;
    brand_note: string | null;
    spec_text: string | null;
    import_id: string;
  };
  const toInsert: InsertRow[] = [];
  const toUpdate: UpdateRow[] = [];

  for (const n of sorted) {
    const itemType = n.type === "section" ? "section" : n.type === "spec" ? "spec" : "item";
    const key = dedupeKey(n.tenderCode, n.name);
    const dup = existingMap.get(key);
    const parentServerId = n.parentId ? idMap.get(n.parentId) ?? null : null;

    if (dup) {
      idMap.set(n.id, dup.id);
      if (dup.modified) continue; // 保留使用者修改
      toUpdate.push({
        id: dup.id,
        parent_id: parentServerId,
        sort_path: n.sortPath,
        depth: n.depth,
        item_type: itemType,
        unit: n.unit,
        quantity: n.quantity,
        unit_price: n.unitPrice,
        total_price: n.totalPrice,
        brand_note: n.brandNote,
        spec_text: n.specText,
        import_id: importId,
      });
      if (itemType !== "section") updatedCount++;
    } else {
      const newId = randomUUID();
      idMap.set(n.id, newId);
      toInsert.push({
        id: newId,
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
      });
      if (itemType !== "section") importedCount++;
    }
  }

  // 4a) Batch insert 新項 — 因為 parent_id 已是 server UUID,FK self-reference 不會炸
  //     (parent 在同一 batch 內依 sort 順序排序;Postgres 接受同 statement 內的自引用 FK)。
  //     大標單(2000+ 列)時若一次送會被 Supabase / PostgREST 默默截斷在 ~1000 筆。
  //     拆成 500 筆 chunks 連續送 — 每個 chunk 內 sort_path 已遞增,parent 仍在同 chunk
  //     或更早的 chunk 中(已存在 DB),FK 不會破。
  if (toInsert.length > 0) {
    const CHUNK_SIZE = 500;
    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + CHUNK_SIZE);
      const { error: insErr } = await supabase
        .from("case_work_items")
        .insert(chunk);
      if (insErr) {
        return {
          ok: false,
          error: `新增工項失敗（第 ${i + 1}-${i + chunk.length} 列）：${insErr.message}`,
        };
      }
    }
  }

  // 4b) Batch update 既有未鎖項 — Supabase 沒原生 batch update,
  //     用 upsert(只列已存在的 id,onConflict='id')一次寫入。
  //     注意:upsert 不能改 case_id / tender_code / name(dedupe key 與所有權)
  //     所以 UpdateRow 不含 case_id / tender_code / name,但 upsert 必須帶這些 NOT NULL 欄位 →
  //     改用一條一條 update 仍是 N round-trip。
  //     折衷:如果 toUpdate 很多就 fall back to per-row(暫時),否則 5 個以下併行 OK。
  //     實務上「未鎖項 update」只在重複匯入時發生,通常 <50,影響小;
  //     但仍用 4-concurrency 池避免 sequential await。
  if (toUpdate.length > 0) {
    const concurrency = 4;
    let cursor = 0;
    let firstErr: string | null = null;
    const workers = Array.from(
      { length: Math.min(concurrency, toUpdate.length) },
      async () => {
        while (true) {
          const i = cursor++;
          if (i >= toUpdate.length || firstErr) return;
          const u = toUpdate[i];
          const { error } = await supabase
            .from("case_work_items")
            .update({
              parent_id: u.parent_id,
              sort_path: u.sort_path,
              depth: u.depth,
              item_type: u.item_type,
              unit: u.unit,
              quantity: u.quantity,
              unit_price: u.unit_price,
              total_price: u.total_price,
              brand_note: u.brand_note,
              spec_text: u.spec_text,
              import_id: u.import_id,
            })
            .eq("id", u.id);
          if (error && !firstErr) firstErr = error.message;
        }
      }
    );
    await Promise.all(workers);
    if (firstErr) return { ok: false, error: "更新工項失敗：" + firstErr };
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
  await requireRole(["office_staff", "owner"]);

  const caseIdRaw = String(formData.get("caseId") ?? "");
  const importIdRaw = String(formData.get("importId") ?? "");
  const caseIdParse = UuidSchema.safeParse(caseIdRaw);
  const importIdParse = UuidSchema.safeParse(importIdRaw);
  if (!caseIdParse.success || !importIdParse.success) return;
  const caseId = caseIdParse.data;
  const importId = importIdParse.data;

  const supabase = await createClient();

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
