import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";

/**
 * 角色守則 helper — 集中放在這裡,讓 server actions / page 直接呼叫,
 * 不要每支再各自抄一份 `await supabase.auth.getUser() + select profile`。
 *
 * 約定:
 *  - `is_active = false` 視同未登入(被停用的人 ban_duration 也擋了,但這層保險再擋一次)
 *  - profile 不存在 → throw(不在這裡自動 create,避免半合法狀態)
 *  - 錯誤訊息一律中文,讓 server action 直接把 error.message 丟回 client 也 OK
 */

export type Actor = {
  id: string;
  role: UserRole;
  fullName: string | null;
  isActive: boolean;
  email: string | null;
  company: string | null;
};

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, full_name, is_active, company")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    // 有 auth user 但沒 profile — 異常狀態,不要嘗試自動修補,直接視為未登入
    throw new Error("請先登入");
  }
  if (!profile.is_active) {
    return null;
  }
  return {
    id: profile.id as string,
    role: profile.role as UserRole,
    fullName: (profile.full_name as string | null) ?? null,
    isActive: !!profile.is_active,
    email: user.email ?? null,
    company: (profile.company as string | null) ?? null,
  };
});

/**
 * 拿登入者 + role;未登入 / 被停用 / 沒 profile → throw。
 * Server actions 直接 `const me = await getActor()` 即可。
 */
export async function getActor(): Promise<Actor> {
  const actor = await loadActor();
  if (!actor) throw new Error("請先登入");
  return actor;
}

/**
 * 限定 role;不符合 throw「權限不足」。
 * 常用:`await requireRole(["office_staff", "owner"])`
 */
export async function requireRole(allowed: UserRole[]): Promise<Actor> {
  const actor = await getActor();
  if (!allowed.includes(actor.role)) {
    throw new Error("權限不足");
  }
  return actor;
}

/**
 * 不 throw 版本 — 給 server component / page 用,可以拿來決定要 redirect 還是顯示頁面。
 * 未登入 / 被停用 → null;profile 不存在仍會 throw(這是異常,不該靜默)。
 */
export async function tryGetActor(): Promise<Actor | null> {
  return loadActor();
}
