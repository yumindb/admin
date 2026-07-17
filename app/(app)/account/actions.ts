"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/require-role";
import { generateBindingCode } from "@/lib/line/binding";
import { BINDING_CODE_TTL_MINUTES } from "@/lib/line/constants";

export type ChangePasswordState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | undefined;

const Schema = z
  .object({
    current_password: z.string().min(1, "請輸入目前密碼"),
    new_password: z.string().min(6, "新密碼至少 6 碼").max(72, "密碼最長 72 碼"),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: "兩次輸入的新密碼不一致",
    path: ["confirm_password"],
  })
  .refine((d) => d.current_password !== d.new_password, {
    message: "新密碼不能與舊密碼相同，請改用其他密碼",
    path: ["new_password"],
  });

/**
 * 使用者改自己密碼 — 兩段式:
 *   1. 用「目前密碼」+ email 重新驗證一次(防 cookie 被偷後直接改密碼)
 *   2. 通過後 supabase.auth.updateUser({ password }) 套上新密碼
 *
 * 這條是讓員工自助修改的入口;管理端的「重設密碼」(staff/actions.ts)維持原樣,
 * 老闆 / 辦公室助理仍可幫忘記密碼的員工強制重發。
 */
export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const parsed = Schema.safeParse({
    current_password: formData.get("current_password"),
    new_password: formData.get("new_password"),
    confirm_password: formData.get("confirm_password"),
  });
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const firstField = Object.values(flat.fieldErrors)[0]?.[0];
    return { ok: false, error: firstField ?? flat.formErrors[0] ?? "格式不正確" };
  }
  const { current_password, new_password } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return { ok: false, error: "未登入或缺少 Email，請重新登入" };
  }

  // 重新驗證目前密碼 — Supabase 沒有獨立的 verifyPassword API,我們在「另一個」
  // client 上 signInWithPassword 走一次。
  // 重點: 不能用主 SSR client (createClient),因為它與 cookie 綁定,signInWithPassword
  // 失敗時會把現有 session cookie 清掉 → 使用者被登出。
  // 改用獨立的 anon client (persistSession: false),驗證結果只影響本地物件,
  // 對主 session 沒副作用。
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return { ok: false, error: "伺服器設定錯誤（Supabase env 缺失）" };
  }
  const verifier = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const reauth = await verifier.auth.signInWithPassword({
    email: user.email,
    password: current_password,
  });
  if (reauth.error) {
    return { ok: false, error: "目前密碼不正確" };
  }

  // 通過驗證後,套上新密碼。updateUser 是針對「目前已登入 session」的 user,
  // 走主 SSR client 才會更新到正確的 session。
  const upd = await supabase.auth.updateUser({ password: new_password });
  if (upd.error) {
    return { ok: false, error: "更新失敗：" + upd.error.message };
  }

  revalidatePath("/account");
  return { ok: true, message: "密碼已更新。下次登入請使用新密碼。" };
}

// ============================================================
// LINE 綁定(migration-2.27:line_bindings,RLS 只准動自己那列)
// ============================================================

export type BindingCodeResult =
  | { ok: true; code: string; ttlMinutes: number }
  | { ok: false; error: string };

/**
 * 產生 6 位數綁定碼(30 分鐘有效)。
 * 使用者把碼傳給 LINE 官方帳號,webhook 比對後完成綁定。
 * 重複按 = 換一組新碼(舊碼即失效)。
 */
export async function generateLineBindingCodeAction(): Promise<BindingCodeResult> {
  const me = await getActor();
  const supabase = await createClient();
  const expiresAt = new Date(
    Date.now() + BINDING_CODE_TTL_MINUTES * 60 * 1000,
  ).toISOString();

  // 6 位數有一百萬組,撞碼機率極低;撞到(unique violation)就重骰,最多 5 次
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateBindingCode();
    const { error } = await supabase.from("line_bindings").upsert(
      {
        profile_id: me.id,
        binding_code: code,
        binding_code_expires_at: expiresAt,
      },
      { onConflict: "profile_id" },
    );
    if (!error) {
      revalidatePath("/account");
      return { ok: true, code, ttlMinutes: BINDING_CODE_TTL_MINUTES };
    }
    if (!error.message.includes("duplicate") && error.code !== "23505") {
      return { ok: false, error: "產生綁定碼失敗：" + error.message };
    }
  }
  return { ok: false, error: "產生綁定碼失敗，請再試一次" };
}

export type LineActionResult = { ok: true } | { ok: false; error: string };

/** 解除綁定(之後不再收到任何通知;可隨時重新綁定) */
export async function unbindLineAction(): Promise<LineActionResult> {
  const me = await getActor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("line_bindings")
    .update({
      line_user_id: null,
      bound_at: null,
      binding_code: null,
      binding_code_expires_at: null,
    })
    .eq("profile_id", me.id);
  if (error) return { ok: false, error: "解除綁定失敗：" + error.message };
  revalidatePath("/account");
  return { ok: true };
}

/** 暫停 / 恢復通知(保留綁定) */
export async function setLineNotificationsAction(
  enabled: boolean,
): Promise<LineActionResult> {
  const me = await getActor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("line_bindings")
    .update({ notifications_enabled: enabled })
    .eq("profile_id", me.id);
  if (error) return { ok: false, error: "設定失敗：" + error.message };
  revalidatePath("/account");
  return { ok: true };
}
