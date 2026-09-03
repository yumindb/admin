import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";
import { ERROR_DIGEST, type ErrorDigest } from "./error-codes";

/**
 * 角色守則 helper — 集中放在這裡,讓 server actions / page 直接呼叫,
 * 不要每支再各自抄一份 `await supabase.auth.getUser() + select profile`。
 *
 * 約定:
 *  - `is_active = false` 視同未登入(被停用的人 ban_duration 也擋了,但這層保險再擋一次)
 *  - profile 不存在 → throw(不在這裡自動 create,避免半合法狀態)
 *  - 錯誤訊息一律中文,讓 server action 直接把 error.message 丟回 client 也 OK
 *  - 丟出的 Error 一律帶 `digest`(見 error-codes.ts):production 下 Server Component
 *    的 error.message 會被 React 遮掉,app/error.tsx 只能靠 digest 認出是哪一類
 */

export type Actor = {
  id: string;
  role: UserRole;
  fullName: string | null;
  isActive: boolean;
  email: string | null;
  company: string | null;
};

/** 帶 digest 的 Error — Next.js 看到已有 digest 就原樣傳到 client,不會另外算 hash */
export function authError(digest: ErrorDigest, message: string): Error {
  return Object.assign(new Error(message), { digest });
}

type ProfileRow = {
  id: string;
  role: string;
  full_name: string | null;
  is_active: boolean;
  company: string | null;
};

/**
 * 讀 profile。查詢**失敗**(連線 / DB 暫時性錯誤)跟查**不到**是兩回事:
 * 以前 `const { data } = …` 把 error 吞掉,暫時性失敗會被當成「沒有 profile」
 * → 丟「請先登入」→ 使用者明明登入著卻看到一整頁錯誤(2026-09-03 業主回報,
 * 三秒後重進首頁又正常)。現在失敗先原地重試一次,再失敗才丟可重試的錯誤。
 */
async function loadProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProfileRow | null> {
  let lastMessage = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, role, full_name, is_active, company")
      .eq("id", userId)
      .maybeSingle();
    if (!error) return (data as ProfileRow | null) ?? null;
    lastMessage = error.message;
    console.error(
      `[require-role] 讀 profile 失敗(第 ${attempt} 次) user=${userId} code=${error.code ?? "-"}: ${error.message}`,
    );
  }
  throw authError(
    ERROR_DIGEST.profileLoadFailed,
    `讀取帳號資料失敗:${lastMessage}`,
  );
}

/**
 * ⚠ 一定要包 React `cache()`。
 *
 * `auth.getUser()` 每次都會真的打一趟 Supabase Auth server 驗 JWT(不是本地解),
 * 而一次導覽會經過 middleware → layout → page(→ 有些頁還有子元件)。沒有 cache
 * 的話光「你是誰」就要來回三四次,加上每次都重撈一次 profile — 2026-08 業主回報
 * 「按一下都很慢」的主因之一。cache() 讓同一個 request 內只查一次。
 */
const loadActor = cache(async function loadActor(): Promise<Actor | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await loadProfile(supabase, user.id);

  if (!profile) {
    // 有 auth user 但沒 profile — 異常狀態,不要嘗試自動修補,直接視為未登入。
    // 留一行 log:這種帳號要人工處理(補 profile 或刪 auth user),不留就查不到是誰。
    console.error(`[require-role] auth user ${user.id} 沒有 profile`);
    throw authError(ERROR_DIGEST.authRequired, "請先登入");
  }
  if (!profile.is_active) {
    return null;
  }
  return {
    id: profile.id,
    role: profile.role as UserRole,
    fullName: profile.full_name ?? null,
    isActive: !!profile.is_active,
    email: user.email ?? null,
    company: profile.company ?? null,
  };
});

/**
 * 拿登入者 + role;未登入 / 被停用 / 沒 profile → throw。
 * Server actions 直接 `const me = await getActor()` 即可。
 */
export async function getActor(): Promise<Actor> {
  const actor = await loadActor();
  if (!actor) throw authError(ERROR_DIGEST.authRequired, "請先登入");
  return actor;
}

/**
 * 限定 role;不符合 throw「權限不足」。
 * 常用:`await requireRole(["office_staff", "owner"])`
 */
export async function requireRole(allowed: UserRole[]): Promise<Actor> {
  const actor = await getActor();
  if (!allowed.includes(actor.role)) {
    throw authError(ERROR_DIGEST.forbidden, "權限不足");
  }
  return actor;
}

/**
 * 不 throw 版本 — 給 server component / page 用,可以拿來決定要 redirect 還是顯示頁面。
 * 未登入 / 被停用 → null;profile 不存在或查詢失敗仍會 throw(這是異常,不該靜默)。
 */
export async function tryGetActor(): Promise<Actor | null> {
  return loadActor();
}
