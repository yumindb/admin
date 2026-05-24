"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

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
