import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetActor } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { loadPayrollSettings } from "@/lib/payroll/settings";
import { canEditPayrollRules } from "@/lib/payroll/access";
import { NextStepHint } from "@/components/next-step-hint";
import { PayrollSettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

/**
 * 薪資規則設定頁(office_staff / owner)。
 * 六組規則各自獨立儲存;讀出來的值已經過 zod 補預設,所以 migration 沒跑也有東西可看。
 */
export default async function PayrollSettingsPage() {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (!canEditPayrollRules(actor.role)) redirect("/");

  const supabase = await createClient();
  const settings = await loadPayrollSettings(supabase);

  return (
    <div className="mx-auto max-w-4xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/payroll" className="hover:text-accent">薪資</Link>
        <span className="mx-1.5">／</span>
        <span>規則設定</span>
      </nav>
      <h1 className="mb-2 text-2xl font-semibold text-primary md:text-3xl">薪資規則設定</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        每一組各自儲存。預設值照勞基法一例一休;改了就照改的算,不用改程式、不用重新部署。
      </p>

      <NextStepHint tone="muted" className="mb-6">
        倍率是「時薪 × 倍率」。時薪 = 月薪 ÷ 30 ÷ 每日正常工時(日薪人員 = 日薪 ÷ 每日正常工時)。
        遲到扣款預設關閉 — 裕民目前不扣,機制先留著。
      </NextStepHint>

      <PayrollSettingsForm initial={settings} />
    </div>
  );
}
