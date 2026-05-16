import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import { EditCaseForm } from "./edit-case-form";
import type { Case } from "@/lib/types";

export default async function EditCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // 案件編輯只給 office_staff / owner;其他角色直接導回 case 詳情(避免 500)
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role !== "office_staff" && actor.role !== "owner") {
    redirect(`/cases/${id}`);
  }

  const supabase = await createClient();
  const { data: caseRow } = await supabase
    .from("cases")
    .select(
      "id, name, code, company, location, client, started_at, expected_end, notes, lat, lng, geofence_radius_m",
    )
    .eq("id", id)
    .maybeSingle();

  if (!caseRow) notFound();
  const c = caseRow as Pick<
    Case,
    | "id"
    | "name"
    | "code"
    | "company"
    | "location"
    | "client"
    | "started_at"
    | "expected_end"
    | "notes"
    | "lat"
    | "lng"
    | "geofence_radius_m"
  >;

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/cases" className="hover:text-accent">
          案件總覽
        </Link>
        <span className="mx-1.5">／</span>
        <Link href={`/cases/${id}`} className="hover:text-accent">
          {c.name}
        </Link>
        <span className="mx-1.5">／</span>
        <span>編輯</span>
      </nav>
      <h1 className="mb-7 text-2xl font-semibold text-primary md:text-3xl">編輯案件</h1>

      <div className="rounded-lg border border-[#E0DCD6] bg-card p-6 md:p-8">
        <EditCaseForm
          caseId={c.id}
          defaults={{
            name: c.name,
            code: c.code,
            company: c.company,
            location: c.location,
            client: c.client,
            started_at: c.started_at,
            expected_end: c.expected_end,
            notes: c.notes,
            lat: c.lat,
            lng: c.lng,
            geofence_radius_m: c.geofence_radius_m,
          }}
        />
      </div>
    </div>
  );
}
