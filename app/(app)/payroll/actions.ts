"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { createServiceClient } from "@/lib/supabase/server";
import { requirePayrollAccess } from "@/lib/payroll/access";
import {
  PAYROLL_SCHEMAS,
  PAYROLL_SECTION_LABEL,
  PAYROLL_SETTING_KEYS,
  type PayrollSettingSection,
} from "@/lib/payroll/settings";
import type { PayrollActionResult } from "./types";

/**
 * 人事／薪資 Phase A 的 server actions。
 *
 * 權限分兩層(lib/payroll/access.ts):
 *   規則、假日 → requireRole(['office_staff','owner'])
 *   薪制金額   → requirePayrollAccess()(owner 或被授權的助理)
 *   授權旗標   → 只有 owner
 * 寫入一律走 service-role(這幾張表都沒開 INSERT / UPDATE policy)。
 */

function fail(error: string, fieldErrors?: Record<string, string[]>): PayrollActionResult {
  return { ok: false, error, fieldErrors };
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

const SECTION_KEYS = Object.keys(PAYROLL_SETTING_KEYS) as [
  PayrollSettingSection,
  ...PayrollSettingSection[],
];

/** 儲存一組薪資規則(整組覆寫)。value 先過該組的 zod schema,壞掉的欄位直接回錯。 */
export async function savePayrollSettingAction(input: {
  section: PayrollSettingSection;
  value: unknown;
}): Promise<PayrollActionResult> {
  let actorId: string;
  try {
    actorId = (await requireRole(["office_staff", "owner"])).id;
  } catch (e) {
    return fail(errorMessage(e, "權限不足"));
  }

  const sectionParsed = z.enum(SECTION_KEYS).safeParse(input?.section);
  if (!sectionParsed.success) return fail("不認識的設定分類");
  const section = sectionParsed.data;

  const schema = PAYROLL_SCHEMAS[section];
  const raw =
    input.value && typeof input.value === "object" && !Array.isArray(input.value)
      ? input.value
      : {};
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return fail("有欄位填得不對,請檢查紅字", fieldErrors);
  }

  const admin = createServiceClient();
  const { error } = await admin.from("app_settings").upsert(
    {
      key: PAYROLL_SETTING_KEYS[section],
      value: parsed.data,
      description: `薪資規則:${PAYROLL_SECTION_LABEL[section]}(結構見 lib/payroll/settings.ts)`,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) return fail("儲存失敗:" + error.message);

  revalidatePath("/payroll");
  revalidatePath("/payroll/settings");
  return { ok: true };
}

const PayProfileSchema = z.object({
  userId: z.string().uuid(),
  employmentType: z.enum(["monthly", "daily"]),
  amount: z.number().int("金額要是整數").min(0, "金額不能是負的").max(10_000_000),
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "生效日格式要是 YYYY-MM-DD"),
  note: z.string().trim().max(200).optional().or(z.literal("")),
});

/** 新增一筆薪制(append-only:調薪就是再新增一筆新的生效日) */
export async function savePayProfileAction(
  input: z.input<typeof PayProfileSchema>,
): Promise<PayrollActionResult> {
  let actorId: string;
  try {
    actorId = (await requirePayrollAccess()).id;
  } catch (e) {
    return fail(errorMessage(e, "權限不足"));
  }

  const parsed = PayProfileSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "有欄位填得不對",
      parsed.error.flatten().fieldErrors as Record<string, string[]>,
    );
  }
  const data = parsed.data;

  const admin = createServiceClient();
  const { data: target, error: targetErr } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", data.userId)
    .maybeSingle();
  if (targetErr) return fail("讀取人員失敗:" + targetErr.message);
  if (!target) return fail("找不到這位人員");

  const { error } = await admin.from("employee_pay_profiles").insert({
    user_id: data.userId,
    employment_type: data.employmentType,
    amount: data.amount,
    effective_from: data.effectiveFrom,
    note: data.note ? data.note : null,
    created_by: actorId,
  });
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return fail("薪制資料表還沒建立(migration-2.40 尚未執行),請先跟 Evelyn 說");
    }
    return fail("儲存失敗:" + error.message);
  }

  revalidatePath("/staff");
  revalidatePath("/payroll");
  return { ok: true };
}

/** 老闆授權 / 取消授權某位辦公室助理處理薪資(profiles.can_manage_payroll) */
export async function setPayrollAccessAction(input: {
  userId: string;
  enabled: boolean;
}): Promise<PayrollActionResult> {
  try {
    await requireRole(["owner"]);
  } catch (e) {
    return fail(errorMessage(e, "只有核定人可以授權薪資權限"));
  }

  const parsed = z
    .object({ userId: z.string().uuid(), enabled: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return fail("輸入格式錯誤");

  const admin = createServiceClient();
  const { data: target, error: targetErr } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", parsed.data.userId)
    .maybeSingle();
  if (targetErr) return fail("讀取人員失敗:" + targetErr.message);
  if (!target) return fail("找不到這位人員");
  if (parsed.data.enabled && target.role !== "office_staff") {
    return fail("只有辦公室助理需要這個授權(核定人本來就看得到薪資)");
  }

  const { error } = await admin
    .from("profiles")
    .update({ can_manage_payroll: parsed.data.enabled })
    .eq("id", parsed.data.userId);
  if (error) return fail("儲存失敗:" + error.message);

  revalidatePath("/staff");
  revalidatePath("/payroll");
  return { ok: true };
}

const HolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式要是 YYYY-MM-DD"),
  name: z.string().trim().min(1, "名稱必填").max(60),
  isWorkday: z.boolean().default(false),
});

/** 新增 / 修改一天(同一天重填就是覆蓋) */
export async function saveHolidayAction(
  input: z.input<typeof HolidaySchema>,
): Promise<PayrollActionResult> {
  let actorId: string;
  try {
    actorId = (await requireRole(["office_staff", "owner"])).id;
  } catch (e) {
    return fail(errorMessage(e, "權限不足"));
  }

  const parsed = HolidaySchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "有欄位填得不對",
      parsed.error.flatten().fieldErrors as Record<string, string[]>,
    );
  }
  if (Number.isNaN(new Date(`${parsed.data.date}T00:00:00Z`).getTime())) {
    return fail("日期不存在", { date: ["日期不存在"] });
  }

  const admin = createServiceClient();
  const { error } = await admin.from("holidays").upsert(
    {
      holiday_date: parsed.data.date,
      name: parsed.data.name,
      is_workday: parsed.data.isWorkday,
      created_by: actorId,
    },
    { onConflict: "holiday_date" },
  );
  if (error) return fail("儲存失敗:" + error.message);

  revalidatePath("/payroll/holidays");
  return { ok: true };
}

export async function deleteHolidayAction(input: {
  date: string;
}): Promise<PayrollActionResult> {
  try {
    await requireRole(["office_staff", "owner"]);
  } catch (e) {
    return fail(errorMessage(e, "權限不足"));
  }
  const parsed = z
    .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .safeParse(input);
  if (!parsed.success) return fail("日期格式錯誤");

  const admin = createServiceClient();
  const { error } = await admin
    .from("holidays")
    .delete()
    .eq("holiday_date", parsed.data.date);
  if (error) return fail("刪除失敗:" + error.message);

  revalidatePath("/payroll/holidays");
  return { ok: true };
}
