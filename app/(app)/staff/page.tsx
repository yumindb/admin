import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { emailToUsername } from "@/lib/auth/username";
import type { Profile, UserRole } from "@/lib/types";
import { StaffManager } from "./staff-manager";

export type StaffRow = Profile & {
  email: string | null;
  username: string | null;
  last_sign_in_at: string | null;
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
  const [{ data: profiles }, { data: usersList }] = await Promise.all([
    admin
      .from("profiles")
      .select("*")
      .order("role", { ascending: true })
      .order("full_name", { ascending: true }),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const emailById = new Map<string, string | null>();
  const lastSignInById = new Map<string, string | null>();
  for (const u of usersList?.users ?? []) {
    emailById.set(u.id, u.email ?? null);
    lastSignInById.set(u.id, u.last_sign_in_at ?? null);
  }

  // is_active 容錯：migration-2.6 跑之前欄位不存在 → 視為啟用中，避免整排顯示「已停用」
  const staff: StaffRow[] = ((profiles ?? []) as Profile[]).map((p) => {
    const email = emailById.get(p.id) ?? null;
    return {
      ...p,
      is_active: p.is_active ?? true,
      email,
      username: emailToUsername(email),
      last_sign_in_at: lastSignInById.get(p.id) ?? null,
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

  return (
    <StaffManager
      currentUserId={user.id}
      currentUserRole={me.role as UserRole}
      staffByRole={Object.fromEntries(byRole) as Record<UserRole, StaffRow[]>}
    />
  );
}
