import { cache } from "react";
import { authError, getActor, type Actor } from "@/lib/auth/require-role";
import { ERROR_DIGEST } from "@/lib/auth/error-codes";
import { createClient } from "@/lib/supabase/server";

/**
 * 薪資的兩層權限(2026-09-26 Evelyn 拍板「權限分開」):
 *
 *   規則設定(倍率、天數、開關、假日行事曆) → office_staff / owner:用 requireRole 就好
 *   薪資金額、月結、薪資單                → owner,或老闆在 /staff 勾了「可處理薪資」的 office_staff
 *
 * 旗標在 profiles.can_manage_payroll(migration-2.40)。故意**不**加進 loadActor 的 select:
 * migration 還沒跑時那一欄不存在,放進 loadActor 會讓全站登入都壞掉。
 * 這裡另外查一次,查不到(欄位不存在 / 查詢失敗)一律當「沒有權限」— 安全預設是嚴的那邊。
 */
export const hasPayrollAccess = cache(async function hasPayrollAccess(
  actor: Pick<Actor, "id" | "role">,
): Promise<boolean> {
  if (actor.role === "owner") return true;
  if (actor.role !== "office_staff") return false;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("can_manage_payroll")
    .eq("id", actor.id)
    .maybeSingle();
  if (error) return false;
  return (data as { can_manage_payroll?: boolean } | null)?.can_manage_payroll === true;
});

/** server action / page 開頭呼叫:沒有薪資金額權限就 throw(訊息可直接回給 client) */
export async function requirePayrollAccess(): Promise<Actor> {
  const actor = await getActor();
  if (!(await hasPayrollAccess(actor))) {
    throw authError(
      ERROR_DIGEST.forbidden,
      "只有核定人,或被授權處理薪資的辦公室助理可以進行這個操作",
    );
  }
  return actor;
}

/** 規則設定的權限:辦公室助理以上(不看薪資旗標) */
export function canEditPayrollRules(role: Actor["role"]): boolean {
  return role === "office_staff" || role === "owner";
}
