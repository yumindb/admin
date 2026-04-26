import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ImportPreview } from "@/components/import-preview";
import type { Case } from "@/lib/types";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: caseRow } = await supabase
    .from("cases")
    .select("id, name, code")
    .eq("id", id)
    .maybeSingle();

  if (!caseRow) notFound();
  const c = caseRow as Pick<Case, "id" | "name" | "code">;

  return (
    <div className="mx-auto max-w-6xl">
      <nav className="mb-3 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-accent">
          案件
        </Link>
        <span className="mx-1.5">／</span>
        <Link href={`/cases/${id}`} className="hover:text-accent">
          {c.name}
        </Link>
        <span className="mx-1.5">／</span>
        <span>匯入標單</span>
      </nav>

      <h1 className="mb-1 text-xl font-semibold text-primary">匯入標單</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {c.code ? `${c.code} · ` : ""}
        {c.name}
      </p>

      <ImportPreview caseId={id} />
    </div>
  );
}
