"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { CaseFormState } from "@/components/case-form";

const EditCaseSchema = z.object({
  caseId: z.string().uuid(),
  name: z.string().trim().min(1, "案件名稱必填").max(200),
  code: z.string().trim().max(60).optional().or(z.literal("")),
  location: z.string().trim().max(200).optional().or(z.literal("")),
  client: z.string().trim().max(120).optional().or(z.literal("")),
  started_at: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export async function updateCaseAction(
  _prev: CaseFormState,
  formData: FormData
): Promise<CaseFormState> {
  const parsed = EditCaseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const { caseId, ...data } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("cases")
    .update({
      name: data.name,
      code: data.code || null,
      location: data.location || null,
      client: data.client || null,
      started_at: data.started_at || null,
      notes: data.notes || null,
    })
    .eq("id", caseId);

  if (error) return { error: "儲存失敗:" + error.message };

  revalidatePath("/");
  revalidatePath(`/cases/${caseId}`);
  redirect(`/cases/${caseId}`);
}

export async function deleteCaseAction(formData: FormData) {
  const caseId = String(formData.get("caseId") ?? "");
  if (!caseId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // case_work_items / tender_imports 透過 ON DELETE CASCADE 自動清掉
  await supabase.from("cases").delete().eq("id", caseId);

  revalidatePath("/");
  redirect("/");
}
