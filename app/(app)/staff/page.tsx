import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isDualSignEnabled } from "@/lib/settings";
import { emailToUsername } from "@/lib/auth/username";
import type { NotificationPrefs } from "@/lib/notifications/prefs";
import type { Profile, UserRole } from "@/lib/types";
import { StaffManager } from "./staff-manager";

export type StaffRow = Profile & {
  email: string | null;
  username: string | null;
  last_sign_in_at: string | null;
  /** LINE 綁定狀態(migration-2.27;表不存在時皆為未綁定) */
  line_bound: boolean;
  /** 通知分類開關(migration-2.28;null = 從未設定 → 角色預設) */
  notification_prefs: NotificationPrefs | null;
};

const ROLE_ORDER: UserRole[] = [
  "owner",
  "office_staff",
  "site_supervisor",
  "field_assistant",
];

export default async function StaffPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "office_staff" && me?.role !== "owner") {
    redirect("/");
  }

  // 抓所有 profile + 用 service role 拿對應 email
  const admin = createServiceClient();
  // 核定雙簽開關(migration-2.34)— 跟人員清單無關,一起發不排隊
  const dualSignPromise = isDualSignEnabled(supabase);
  const [{ data: profiles }, { data: usersList }, { data: bindings }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("*")
        .order("role", { ascending: true })
        .order("full_name", { ascending: true }),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      // migration-2.27 沒跑時 query 會錯,data 為 null → 全視為未綁定
      admin
        .from("line_bindings")
        .select("profile_id, line_user_id, notification_prefs"),
    ]);

  const emailById = new Map<string, string | null>();
  const lastSignInById = new Map<string, string | null>();
  for (const u of usersList?.users ?? []) {
    emailById.set(u.id, u.email ?? null);
    lastSignInById.set(u.id, u.last_sign_in_at ?? null);
  }

  const bindingById = new Map<
    string,
    { bound: boolean; prefs: NotificationPrefs | null }
  >();
  for (const b of bindings ?? []) {
    bindingById.set(b.profile_id as string, {
      bound: Boolean(b.line_user_id),
      prefs: (b.notification_prefs as NotificationPrefs | null) ?? null,
    });
  }

  // is_active 容錯：migration-2.6 跑之前欄位不存在 → 視為啟用中，避免整排顯示「已停用」
  const staff: StaffRow[] = ((profiles ?? []) as Profile[]).map((p) => {
    const email = emailById.get(p.id) ?? null;
    const binding = bindingById.get(p.id);
    return {
      ...p,
      is_active: p.is_active ?? true,
      email,
      username: emailToUsername(email),
      last_sign_in_at: lastSignInById.get(p.id) ?? null,
      line_bound: binding?.bound ?? false,
      notification_prefs: binding?.prefs ?? null,
    };
  });

  // 依角色分組 + 依角色階層排序
  const byRole = new Map<UserRole, StaffRow[]>();
  for (const r of ROLE_ORDER) byRole.set(r, []);
  for (const s of staff) {
    const list = byRole.get(s.role as UserRole);
    if (list) list.push(s);
    else byRole.set(s.role as UserRole, [s]);
  }

  const dualSignEnabled = await dualSignPromise;
  const activeOwnerCount = staff.filter(
    (s) => s.role === "owner" && s.is_active,
  ).length;

  return (
    <StaffManager
      currentUserId={user.id}
      currentUserRole={me.role as UserRole}
      staffByRole={Object.fromEntries(byRole) as Record<UserRole, StaffRow[]>}
      dualSignEnabled={dualSignEnabled}
      activeOwnerCount={activeOwnerCount}
    />
  );
}
