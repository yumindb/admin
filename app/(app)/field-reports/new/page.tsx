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

  // migration-2.20 起加 lat/lng 給 CasePicker 依距離排序;
  // geofence_radius_m 給「人在工地範圍內就自動選好案場」用
  const { data: cases } = await supabase
    .from("cases")
    .select("id, name, code, lat, lng, geofence_radius_m")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  const caseOptions: CaseOption[] = (cases ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    code: c.code as string | null,
    lat: c.lat as number | null,
    lng: c.lng as number | null,
    geofence_radius_m: c.geofence_radius_m as number | null,
  }));

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-2xl font-semibold text-primary md:text-3xl">
        新增回報
      </h1>
      <p className="mb-2 text-base text-muted-foreground">
        選一個案場、寫幾個字或拍照，送出就好。
      </p>
      <p className="mb-6 text-sm text-muted-foreground">
        不知道要回報哪個案場？
        <Link
          href="/my-cases"
          className="ml-1 text-accent underline-offset-4 hover:underline"
        >
          看我最近去過的案場
        </Link>
      </p>
      <NewReportForm cases={caseOptions} presetCaseId={presetCaseId} />
    </div>
  );
}
