"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { usernameSchema, usernameToEmail } from "@/lib/auth/username";

export type LoginState = { error?: string } | undefined;

// 速率限制設定:WINDOW_MIN 分鐘內 >= MAX_FAILS 次失敗 → 鎖住此帳號直到視窗滾出。
// 註:login_attempts.email 欄位仍存完整 email(含 @yumin.local 後綴),不需 schema 變動。
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

  // 裝置資訊給 /reports/logins 管理頁看;取不到就 null,不影響登入。
  let userAgent: string | null = null;
  let ip: string | null = null;
  try {
    const h = await headers();
    userAgent = h.get("user-agent")?.slice(0, 300) ?? null;
    // Vercel 的 x-forwarded-for 第一段是真實 client IP
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  } catch {
    // headers() 在少數 context 不可用 — 純紀錄用途,靜默略過
  }

  const { error } = await service.from("login_attempts").insert({
    email: email.toLowerCase(),
    success,
    user_agent: userAgent,
    ip,
  });
  // migration-2.25 還沒跑時新欄位會讓 insert 失敗 — 退回基本欄位,
  // 保住速率限制所需的資料,不擋登入。
  if (error) {
    await service.from("login_attempts").insert({ email: email.toLowerCase(), success });
  }
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const rawUsername = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const rawNext = String(formData.get("next") ?? "");
  // Only allow relative paths to prevent open-redirect attacks
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (!rawUsername || !password) {
    return { error: "請輸入帳號與密碼" };
  }

  const parsed = usernameSchema.safeParse(rawUsername);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "帳號格式不正確" };
  }
  const email = usernameToEmail(parsed.data);

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
    return { error: "登入失敗：帳號或密碼錯誤" };
  }

  redirect(next);
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
