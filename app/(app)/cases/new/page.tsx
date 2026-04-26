import Link from "next/link";
import { NewCaseForm } from "./new-case-form";
import { createClient } from "@/lib/supabase/server";
import { getNextCaseCode } from "@/lib/case-codes";

export default async function NewCasePage() {
  const supabase = await createClient();
  const suggestedCode = await getNextCaseCode(supabase);

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/cases" className="hover:text-accent">
          案件總覽
        </Link>
        <span className="mx-1.5">／</span>
        <span>開新案</span>
      </nav>
      <h1 className="mb-7 text-2xl font-semibold text-primary md:text-3xl">開新案</h1>

      <div className="rounded-lg border border-[#E0DCD6] bg-card p-6 md:p-8">
        <NewCaseForm suggestedCode={suggestedCode} />
      </div>
    </div>
  );
}
