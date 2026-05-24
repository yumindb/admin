"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { usernameSchema, usernameToEmail } from "@/lib/auth/username";
import type { StaffActionResult } from "./types";

async function requireManager() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "未登入" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "office_staff" && profile?.role !== "owner") {
    return { ok: false as const, error: "只有辦公室助理或老闆可以管理人員" };
  }
  return { ok: true as const, currentUserId: user.id };
}

const CreateSchema = z.object({
  username: usernameSchema,
  password: z.string().min(6, "密碼至少 6 碼").max(72),
  full_name: z.string().trim().min(1, "姓名必填").max(60),
  role: z.enum(["owner", "office_staff", "site_supervisor", "field_assistant"]),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
});

export async function createStaffAction(
  _prev: StaffActionResult | undefined,
  formData: FormData,
): Promise<StaffActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = CreateSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
    full_name: formData.get("full_name"),
    role: formData.get("role"),
    phone: formData.get("phone") ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;

  const admin = createServiceClient();
  const created = await admin.auth.admin.createUser({
    email: usernameToEmail(data.username),
    password: data.password,
    email_confirm: true,
    user_metadata: { full_name: data.full_name, role: data.role },
  });
  if (created.error || !created.data.user) {
    const msg = created.error?.message ?? "建立失敗";
    if (/already.*registered|exists/i.test(msg)) {
      return { ok: false, fieldErrors: { username: ["此帳號已建立過"] } };
    }
    return { ok: false, error: msg };
  }

  // handle_new_user trigger 已寫入 profiles。再覆寫一次以確保 role/full_name/phone 落地。
  const upd = await admin
    .from("profiles")
    .update({
      full_name: data.full_name,
      role: data.role,
      phone: data.phone || null,
      is_active: true,
    })
    .eq("id", created.data.user.id);
  if (upd.error) {
    return { ok: false, error: "帳號已建立但 profile 寫入失敗：" + upd.error.message };
  }

  revalidatePath("/staff");
  return { ok: true };
}

const UpdateSchema = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().trim().min(1, "姓名必填").max(60),
  role: z.enum(["owner", "office_staff", "site_supervisor", "field_assistant"]),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
});

export async function updateStaffAction(
  _prev: StaffActionResult | undefined,
  formData: FormData,
): Promise<StaffActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = UpdateSchema.safeParse({
    user_id: formData.get("user_id"),
    full_name: formData.get("full_name"),
    role: formData.get("role"),
    phone: formData.get("phone") ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;

  const admin = createServiceClient();
  const upd = await admin
    .from("profiles")
    .update({
      full_name: data.full_name,
      role: data.role,
      phone: data.phone || null,
    })
    .eq("id", data.user_id);
  if (upd.error) return { ok: false, error: upd.error.message };

  revalidatePath("/staff");
  return { ok: true };
}

export async function resetPasswordAction(
  _prev: StaffActionResult | undefined,
  formData: FormData,
): Promise<StaffActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const userId = String(formData.get("user_id") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!userId) return { ok: false, error: "缺少使用者 ID" };
  if (password.length < 6) {
    return { ok: false, fieldErrors: { password: ["密碼至少 6 碼"] } };
  }

  const admin = createServiceClient();
  const upd = await admin.auth.admin.updateUserById(userId, { password });
  if (upd.error) return { ok: false, error: upd.error.message };

  return { ok: true };
}

export async function toggleActiveAction(formData: FormData): Promise<StaffActionResult> {
  const auth = await requireManager();
  if (!auth.ok) return { ok: false, error: auth.error };

  const userId = String(formData.get("user_id") ?? "");
  const next = formData.get("next") === "true";
  if (!userId) return { ok: false, error: "缺少使用者 ID" };
  if (userId === auth.currentUserId) {
    return { ok: false, error: "無法停用您自己的帳號" };
  }

  const admin = createServiceClient();
  const upd = await admin
    .from("profiles")
    .update({ is_active: next })
    .eq("id", userId);
  if (upd.error) return { ok: false, error: upd.error.message };

  // 真正擋登入：用 ban_duration（停用 = 100 年；啟用 = 'none'）
  const ban = await admin.auth.admin.updateUserById(userId, {
    ban_duration: next ? "none" : "876000h",
  });
  if (ban.error) return { ok: false, error: ban.error.message };

  revalidatePath("/staff");
  return { ok: true };
}
