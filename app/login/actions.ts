"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { usernameSchema, usernameToEmail } from "@/lib/auth/username";
import { safeNextPath } from "@/lib/auth/safe-next";

export type LoginState = { error?: string } | undefined;

// 速率限制:
//   - 同一個帳號、同一個來源 IP:WINDOW_MIN 分鐘內失敗 >= MAX_FAILS 次 → 鎖這個 IP 對這個帳號
//   - 同一個帳號、不分來源:失敗 >= MAX_FAILS_ANY_IP 次 → 整個帳號鎖住(擋換 IP 的猜密碼)
// 2026-09 前只看帳號:任何人對 owner 亂打 3 次錯的密碼,老闆本人就 15 分鐘登不進來,
// 而且可以一直重複 — 等於誰都能讓老闆沒辦法核定日誌。
// 註:login_attempts.email 欄位仍存完整 email(含 @yumin.local 後綴),不需 schema 變動。
const WINDOW_MIN = 15;
const MAX_FAILS = 3;
const MAX_FAILS_ANY_IP = 20;

type LockState = { locked: boolean; remainingMin: number };

/** 失敗紀錄(新 → 舊)達到門檻時,回傳還要鎖多久(鎖到最舊那筆滾出視窗) */
function lockFrom(fails: { attempted_at: string }[], threshold: number): LockState {
  if (fails.length < threshold) return { locked: false, remainingMin: 0 };
  const oldestCounted = new Date(fails[threshold - 1].attempted_at).getTime();
  const remainingMs = oldestCounted + WINDOW_MIN * 60_000 - Date.now();
  if (remainingMs <= 0) return { locked: false, remainingMin: 0 };
  return { locked: true, remainingMin: Math.ceil(remainingMs / 60_000) };
}

async function isLockedOut(email: string, ip: string | null): Promise<LockState> {
  const service = createServiceClient();
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const { data, error } = await service
    .from("login_attempts")
    .select("attempted_at, success, ip")
    .eq("email", email.toLowerCase())
    .eq("success", false)
    .gte("attempted_at", since)
    .order("attempted_at", { ascending: false })
    .limit(MAX_FAILS_ANY_IP);

  if (error || !data) return { locked: false, remainingMin: 0 };

  const account = lockFrom(data, MAX_FAILS_ANY_IP);
  if (account.locked) return account;
  // 取不到 IP 時退回舊行為(只看帳號),寧可偶爾誤鎖也不要完全沒有限制
  const sameSource = ip ? data.filter((r) => r.ip === ip) : data;
  return lockFrom(sameSource, MAX_FAILS);
}

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    return {
      // Vercel 會覆寫 x-real-ip / x-forwarded-for 為真實 client IP(使用者自己帶的會被蓋掉)
      ip: h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    };
  } catch {
    // headers() 在少數 context 不可用 — 純紀錄用途,靜默略過
    return { ip: null, userAgent: null };
  }
}

async function recordAttempt(email: string, success: boolean) {
  const service = createServiceClient();

  // 裝置資訊給 /reports/logins 管理頁看;取不到就 null,不影響登入。
  const { ip, userAgent } = await requestMeta();

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
  const next = safeNextPath(String(formData.get("next") ?? ""));

  if (!rawUsername || !password) {
    return { error: "請輸入帳號與密碼" };
  }

  const parsed = usernameSchema.safeParse(rawUsername);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "帳號格式不正確" };
  }
  const email = usernameToEmail(parsed.data);

  // 先檢查是否鎖定(不消耗 Supabase auth 配額)
  const { ip } = await requestMeta();
  const lock = await isLockedOut(email, ip);
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
