"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { wrapDbError } from "@/lib/db/wrap-error";
import { COMPANIES } from "@/lib/companies";
import type { CaseFormState } from "@/components/case-form";

// 座標欄(migration-2.20):與 new-case 同規則
const LatLngSchema = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(
    z.union([
      z.null(),
      z
        .string()
        .regex(/^-?\d{1,3}(?:\.\d+)?$/, "座標格式錯誤")
        .transform((s) => Number(s)),
    ]),
  );

const EditCaseSchema = z
  .object({
    caseId: z.string().uuid(),
    name: z.string().trim().min(1, "案件名稱必填").max(200),
    code: z.string().trim().max(60).optional().or(z.literal("")),
    company: z.enum(COMPANIES, { message: "請選擇承接公司" }),
    location: z.string().trim().max(200).optional().or(z.literal("")),
    client: z.string().trim().max(120).optional().or(z.literal("")),
    started_at: z.string().trim().optional().or(z.literal("")),
    expected_end: z.string().trim().optional().or(z.literal("")),
    notes: z.string().trim().max(2000).optional().or(z.literal("")),
    lat: LatLngSchema,
    lng: LatLngSchema,
    geofence_radius_m: z
      .string()
      .trim()
      .transform((v) => (v === "" ? 200 : Number(v)))
      .pipe(z.number().int().min(10).max(5000)),
  })
  .refine((d) => (d.lat === null) === (d.lng === null), {
    message: "經緯度必須同時提供或同時留空",
    path: ["lat"],
  })
  .refine((d) => d.lat === null || (d.lat >= -90 && d.lat <= 90), {
    message: "緯度需介於 -90 到 90",
    path: ["lat"],
  })
  .refine((d) => d.lng === null || (d.lng >= -180 && d.lng <= 180), {
    message: "經度需介於 -180 到 180",
    path: ["lng"],
  });

export async function updateCaseAction(
  _prev: CaseFormState,
  formData: FormData
): Promise<CaseFormState> {
  await requireRole(["office_staff", "owner"]);

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
      company: data.company,
      location: data.location || null,
      client: data.client || null,
      started_at: data.started_at || null,
      expected_end: data.expected_end || null,
      notes: data.notes || null,
      lat: data.lat,
      lng: data.lng,
      geofence_radius_m: data.geofence_radius_m,
    })
    .eq("id", caseId);

  if (error) {
    throw wrapDbError(error, "儲存失敗");
  }

  revalidatePath("/cases");
  revalidatePath(`/cases/${caseId}`);
  redirect(`/cases/${caseId}`);
}

const DeleteCaseSchema = z.object({
  caseId: z.string().uuid(),
});

export async function deleteCaseAction(formData: FormData) {
  await requireRole(["office_staff", "owner"]);

  const parsed = DeleteCaseSchema.safeParse({
    caseId: String(formData.get("caseId") ?? ""),
  });
  if (!parsed.success) return;
  const { caseId } = parsed.data;

  const supabase = await createClient();

  // case_work_items / tender_imports 透過 ON DELETE CASCADE 自動清掉
  const { error } = await supabase.from("cases").delete().eq("id", caseId);
  if (error) {
    throw wrapDbError(error, "刪除失敗");
  }

  revalidatePath("/cases");
  redirect("/cases");
}
