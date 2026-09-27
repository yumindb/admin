import { createServiceClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";

/**
 * 員工名冊(service role)。
 *
 * profiles 的 RLS(profiles_self_read)只讓工地主任 / 現場人員讀**自己那一列** —
 * 他們看得到、又要列出別人的頁面(主任的唯讀排班表、出勤報表的人員篩選),
 * 用一般 client 撈只會拿到自己一個人(2026-09-27:主任打開排班表只剩自己一列)。
 *
 * 不放寬 RLS:policy 是整列放行,profiles 還有電話、薪資權限旗標。
 * 這裡只回 id / 姓名 / 角色 / 公司,**呼叫前頁面要先做完自己的角色檢查**。
 * 只要「id → 姓名」用 lib/logs/proxy.ts 的 `loadProfileNames()`。
 *
 * 讀不到回空陣列(同 loadProfileNames,不讓整頁壞掉)。
 */

export type StaffDirectoryEntry = {
  id: string;
  name: string;
  role: UserRole;
  company: string | null;
};

export async function loadStaffDirectory(opts: {
  roles: readonly UserRole[];
  /** true = 只列在職的(排班);false = 停用的也列(報表要查得到離職的人) */
  activeOnly: boolean;
}): Promise<StaffDirectoryEntry[]> {
  let supabase;
  try {
    supabase = createServiceClient();
  } catch (e) {
    console.error("[staff-directory] service client 無法建立:", (e as Error).message);
    return [];
  }
  let query = supabase
    .from("profiles")
    .select("id, full_name, role, company")
    .in("role", [...opts.roles])
    .order("full_name");
  if (opts.activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) {
    console.error("[staff-directory] 讀名冊失敗:", error.message);
    return [];
  }
  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: (p.full_name as string | null) ?? "未命名",
    role: p.role as UserRole,
    company: (p.company as string | null) ?? null,
  }));
}
