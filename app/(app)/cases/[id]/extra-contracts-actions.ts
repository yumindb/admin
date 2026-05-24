"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { wrapDbError } from "@/lib/db/wrap-error";

/**
 * 追加合約 server actions(migration-2.16)。
 *
 * 設計重點:
 *   - 一份合約可包多筆原本是 'unsigned' 的工項。確認簽約 = 把那些工項翻成 'extra'
 *     並 set extra_contract_id 指向新合約。
 *   - bundle_price 可選:沒填就退回用各品項 total_price 加總顯示。
 *   - 拆解(unbundle)合約 = 把 case_work_items 的 item_type 退回 'unsigned' + 清掉 extra_contract_id,
 *     合約本身刪除。在報價談不下來、需重新議價時用。
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

const CreateContractSchema = z.object({
  case_id: z.string().uuid(),
  name: z.string().trim().min(1, "合約名稱必填").max(200),
  bundle_price: NumberLike,
  note: z.string().trim().max(1000).nullable(),
  work_item_ids: z.array(z.string().uuid()).min(1, "至少要選 1 筆工項"),
});

const UpdateContractSchema = z.object({
  contract_id: z.string().uuid(),
  name: z.string().trim().min(1, "合約名稱必填").max(200),
  bundle_price: NumberLike,
  note: z.string().trim().max(1000).nullable(),
});

const DeleteSchema = z.object({
  contract_id: z.string().uuid(),
});

export type ExtraContractActionResult =
  | { ok: true; contractId?: string; warning?: string }
  | { ok: false; error: string };

/**
 * 建立追加合約 — 把指定的多筆 unsigned 工項打包簽約。
 * 各工項會 set item_type='extra' + extra_contract_id。
 * 工項單價、複價維持原樣;bundle_price 由合約承擔(可選)。
 */
export async function createExtraContractAction(
  formData: FormData,
): Promise<ExtraContractActionResult> {
  try {
    await requireRole(["office_staff", "owner"]);

    // 工項 ids 由 formData 多值或 JSON 陣列字串傳入,這邊兩種寫法都收
    const rawIds = formData.getAll("work_item_id");
    const idsFromMulti = rawIds.map((v) => String(v)).filter(Boolean);
    const rawJson = formData.get("work_item_ids");
    let idsFromJson: string[] = [];
    if (typeof rawJson === "string" && rawJson.trim()) {
      try {
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed)) {
          idsFromJson = parsed.map((v) => String(v)).filter(Boolean);
        }
      } catch {
        // ignore — 退回 multi-value
      }
    }
    const work_item_ids = Array.from(
      new Set([...idsFromMulti, ...idsFromJson]),
    );

    const parsed = CreateContractSchema.safeParse({
      case_id: String(formData.get("case_id") ?? ""),
      name: String(formData.get("name") ?? ""),
      bundle_price: (formData.get("bundle_price") as string) || null,
      note: (formData.get("note") as string) || null,
      work_item_ids,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message ?? "資料格式錯誤";
      return { ok: false, error: first };
    }
    const data = parsed.data;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 驗證:選的工項都得是同一個 case_id 的 unsigned,且尚未綁合約
    const { data: targetItems, error: readErr } = await supabase
      .from("case_work_items")
      .select("id, case_id, item_type, extra_contract_id")
      .in("id", data.work_item_ids);
    if (readErr) throw wrapDbError(readErr, "讀取工項失敗");
    if (!targetItems || targetItems.length !== data.work_item_ids.length) {
      return { ok: false, error: "有工項找不到，請重新整理頁面" };
    }
    for (const it of targetItems) {
      if (it.case_id !== data.case_id) {
        return { ok: false, error: "工項與案件不相符" };
      }
      if (it.item_type !== "unsigned") {
        return { ok: false, error: "只能把『未簽約』工項打包成追加合約" };
      }
      if (it.extra_contract_id) {
        return { ok: false, error: "有工項已綁在其他追加合約上" };
      }
    }

    // 1) 建合約
    const { data: contract, error: cErr } = await supabase
      .from("extra_contracts")
      .insert({
        case_id: data.case_id,
        name: data.name,
        bundle_price: data.bundle_price,
        note: data.note,
        signed_at: new Date().toISOString(),
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (cErr || !contract) {
      console.error("[createExtraContractAction] insert contract failed", cErr);
      return { ok: false, error: `建立合約失敗：${cErr?.message ?? "unknown"}` };
    }
    const contractId = contract.id as string;

    // 2) 工項翻 extra + 綁合約 + 補 contract_signed_at(legacy 欄位也順便留著)
    const { error: updErr } = await supabase
      .from("case_work_items")
      .update({
        item_type: "extra",
        extra_contract_id: contractId,
        contract_signed_at: new Date().toISOString(),
        contract_note: data.note,
        quote_status: "quoted",
        modified_by_user: true,
      })
      .in("id", data.work_item_ids);
    if (updErr) {
      // 半完成狀態:合約已建,但工項沒翻完。回滾合約以保資料一致。
      await supabase.from("extra_contracts").delete().eq("id", contractId);
      return {
        ok: false,
        error: `工項更新失敗，已回滾合約：${updErr.message}`,
      };
    }

    revalidatePath(`/cases/${data.case_id}`);
    return { ok: true, contractId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "建立失敗" };
  }
}

/**
 * 更新追加合約欄位(名稱、bundle_price、備註)。不動工項。
 */
export async function updateExtraContractAction(
  formData: FormData,
): Promise<ExtraContractActionResult> {
  try {
    await requireRole(["office_staff", "owner"]);

    const parsed = UpdateContractSchema.safeParse({
      contract_id: String(formData.get("contract_id") ?? ""),
      name: String(formData.get("name") ?? ""),
      bundle_price: (formData.get("bundle_price") as string) || null,
      note: (formData.get("note") as string) || null,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message ?? "資料格式錯誤";
      return { ok: false, error: first };
    }
    const data = parsed.data;

    const supabase = await createClient();
    const { data: row, error: readErr } = await supabase
      .from("extra_contracts")
      .select("id, case_id")
      .eq("id", data.contract_id)
      .maybeSingle();
    if (readErr) throw wrapDbError(readErr, "讀取合約失敗");
    if (!row) return { ok: false, error: "找不到合約" };

    const { error } = await supabase
      .from("extra_contracts")
      .update({
        name: data.name,
        bundle_price: data.bundle_price,
        note: data.note,
      })
      .eq("id", data.contract_id);
    if (error) throw wrapDbError(error, "更新合約失敗");

    revalidatePath(`/cases/${row.case_id as string}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

/**
 * 拆解追加合約 — 把所屬工項退回 'unsigned' 並清空 extra_contract_id;合約本身刪除。
 * 用在報價談不下來、需重新議價的情境。歷史日誌的 work_items.work_item_id 不變,
 * 進度仍持續累加(因為工項還在,只是換 item_type 與失去合約連結)。
 */
export async function unbundleExtraContractAction(
  formData: FormData,
): Promise<ExtraContractActionResult> {
  try {
    await requireRole(["office_staff", "owner"]);

    const parsed = DeleteSchema.safeParse({
      contract_id: String(formData.get("contract_id") ?? ""),
    });
    if (!parsed.success) return { ok: false, error: "資料格式錯誤" };

    const supabase = await createClient();
    const { data: row, error: readErr } = await supabase
      .from("extra_contracts")
      .select("id, case_id")
      .eq("id", parsed.data.contract_id)
      .maybeSingle();
    if (readErr) throw wrapDbError(readErr, "讀取合約失敗");
    if (!row) return { ok: false, error: "找不到合約" };
    const caseId = row.case_id as string;

    // 工項翻回 unsigned + 清欄位
    const { error: updErr } = await supabase
      .from("case_work_items")
      .update({
        item_type: "unsigned",
        extra_contract_id: null,
        contract_signed_at: null,
        contract_note: null,
        modified_by_user: true,
      })
      .eq("extra_contract_id", parsed.data.contract_id);
    if (updErr) throw wrapDbError(updErr, "退回工項失敗");

    // 刪合約本身
    const { error } = await supabase
      .from("extra_contracts")
      .delete()
      .eq("id", parsed.data.contract_id);
    if (error) throw wrapDbError(error, "刪除合約失敗");

    revalidatePath(`/cases/${caseId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "拆解失敗" };
  }
}
