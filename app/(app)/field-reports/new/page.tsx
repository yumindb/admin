import Link from "next/link";
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
    <div className="mx-auto max-w-3xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/field-reports" className="hover:text-accent">
          現場回報
        </Link>
        <span className="mx-1.5">／</span>
        <span>新回報</span>
      </nav>
      <h1 className="mb-7 text-2xl font-semibold text-primary md:text-3xl">新現場回報</h1>

      <NewReportForm cases={caseOptions} presetCaseId={presetCaseId} />
    </div>
  );
}
