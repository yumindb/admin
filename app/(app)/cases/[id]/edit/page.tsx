import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EditCaseForm } from "./edit-case-form";
import type { Case } from "@/lib/types";

export default async function EditCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: caseRow } = await supabase
    .from("cases")
    .select("id, name, code, location, client, started_at, notes")
    .eq("id", id)
    .maybeSingle();

  if (!caseRow) notFound();
  const c = caseRow as Pick<
    Case,
    "id" | "name" | "code" | "location" | "client" | "started_at" | "notes"
  >;

  return (
    <div className="mx-auto max-w-2xl">
      <nav className="mb-3 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-accent">
          案件
        </Link>
        <span className="mx-1.5">／</span>
        <Link href={`/cases/${id}`} className="hover:text-accent">
          {c.name}
        </Link>
        <span className="mx-1.5">／</span>
        <span>編輯</span>
      </nav>
      <h1 className="mb-6 text-xl font-semibold text-primary">編輯案件</h1>

      <div className="rounded-md border border-[#E0DCD6] bg-card p-6">
        <EditCaseForm
          caseId={c.id}
          defaults={{
            name: c.name,
            code: c.code,
            location: c.location,
            client: c.client,
            started_at: c.started_at,
            notes: c.notes,
          }}
        />
      </div>
    </div>
  );
}
