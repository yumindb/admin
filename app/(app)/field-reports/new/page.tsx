import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewReportForm, type CaseOption } from "../new-report-form";
import type { UserRole } from "@/lib/types";

const REPORTERS: UserRole[] = ["field_assistant", "site_supervisor", "owner"];

export default async function NewFieldReportPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  const { case: presetCaseId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !REPORTERS.includes(profile.role as UserRole)) {
    redirect("/field-reports");
  }

  const { data: cases } = await supabase
    .from("cases")
    .select("id, name, code")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  const caseOptions: CaseOption[] = (cases ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    code: c.code as string | null,
  }));

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-2xl font-semibold text-primary md:text-3xl">
        新增回報
      </h1>
      <p className="mb-6 text-base text-muted-foreground">
        選一個案場、寫幾個字或拍照,送出就好。
      </p>
      <NewReportForm cases={caseOptions} presetCaseId={presetCaseId} />
    </div>
  );
}
