"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const NewCaseSchema = z.object({
  name: z.string().trim().min(1, "案件名稱必填").max(200),
  code: z.string().trim().max(60).optional().or(z.literal("")),
  location: z.string().trim().max(200).optional().or(z.literal("")),
  client: z.string().trim().max(120).optional().or(z.literal("")),
  started_at: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  next: z.enum(["detail", "import"]).optional(),
});

export type NewCaseState = { error?: string; fieldErrors?: Record<string, string[]> } | undefined;

export async function createCaseAction(
  _prev: NewCaseState,
  formData: FormData
): Promise<NewCaseState> {
  const parsed = NewCaseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  }
  const data = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "未登入" };

  const { data: row, error } = await supabase
    .from("cases")
    .insert({
      name: data.name,
      code: data.code || null,
      location: data.location || null,
      client: data.client || null,
      started_at: data.started_at || null,
      notes: data.notes || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: "建立失敗：" + error.message };

  revalidatePath("/");
  const target =
    data.next === "import" ? `/cases/${row!.id}/import` : `/cases/${row!.id}`;
  redirect(target);
}
