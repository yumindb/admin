"use server";

import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export type LoginState = { error?: string } | undefined;

// 速率限制設定:WINDOW_MIN 分鐘內 >= MAX_FAILS 次失敗 → 鎖住此 email 直到視窗滾出。
const WINDOW_MIN = 15;
const MAX_FAILS = 3;

async function isLockedOut(email: string): Promise<{ locked: boolean; remainingMin: number }> {
  const service = createServiceClient();
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const { data, error } = await service
    .from("login_attempts")
    .select("attempted_at, success")
    .ilike("email", email)
    .gte("attempted_at", since)
    .order("attempted_at", { ascending: false })
    .limit(MAX_FAILS);

  if (error || !data) return { locked: false, remainingMin: 0 };

  const fails = data.filter((r) => !r.success);
  if (fails.length < MAX_FAILS) return { locked: false, remainingMin: 0 };

  // 鎖到「最舊一筆失敗 + WINDOW_MIN」(這筆滾出視窗後失敗數降到 MAX_FAILS-1,自然解鎖)
  const oldestFailedAt = new Date(fails[fails.length - 1].attempted_at).getTime();
  const unlockAt = oldestFailedAt + WINDOW_MIN * 60_000;
  const remainingMs = unlockAt - Date.now();
  if (remainingMs <= 0) return { locked: false, remainingMin: 0 };
  return { locked: true, remainingMin: Math.ceil(remainingMs / 60_000) };
}

async function recordAttempt(email: string, success: boolean) {
  const service = createServiceClient();
  await service.from("login_attempts").insert({
    email: email.toLowerCase(),
    success,
  });
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const rawNext = String(formData.get("next") ?? "");
  // Only allow relative paths to prevent open-redirect attacks
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (!email || !password) {
    return { error: "請輸入 Email 與密碼" };
  }

  // 先檢查是否鎖定(不消耗 Supabase auth 配額)
  const lock = await isLockedOut(email);
  if (lock.locked) {
    return {
      error: `這個帳號密碼錯誤次數過多，已暫時鎖定。請 ${lock.remainingMin} 分鐘後再試，或聯絡管理員。`,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  // 記錄這次嘗試的結果(成功 / 失敗都記)
  await recordAttempt(email, !error);

  if (error) {
    return { error: "登入失敗：" + error.message };
  }

  redirect(next);
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
