import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomTabNav, type BottomTab } from "@/components/bottom-tab-nav";
import { LogoutButton } from "@/components/logout-button";
import { RouteProgress } from "@/components/route-progress";
import { logoutAction } from "../login/actions";
import { getCompanyShort } from "@/lib/companies";
import { emailToUsername } from "@/lib/auth/username";

const ROLE_LABEL: Record<string, string> = {
  office_staff: "辦公室助理",
  site_supervisor: "工地主任",
  owner: "老闆",
  field_assistant: "現場人員",
};

type DesktopLink = { href: string; label: string; badge?: number };

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, company")
    .eq("id", user.id)
    .single();

  const fullName = profile?.full_name ?? emailToUsername(user.email) ?? "未命名使用者";
  const roleLabel = profile?.role ? ROLE_LABEL[profile.role] ?? profile.role : "—";
  const company = getCompanyShort(profile?.company ?? "裕民");

  // 撈當前使用者角色對應的待簽數量,加在 nav 連結後做 badge
  let approvalsBadge = 0;
  const stageForRole: Record<string, "review" | "audit" | "approve" | null> = {
    site_supervisor: "review",
    office_staff: "audit",
    owner: "approve",
    field_assistant: null,
  };
  const stage = profile?.role ? stageForRole[profile.role] ?? null : null;
  if (stage) {
    let countQuery = supabase
      .from("daily_logs")
      .select("id", { count: "exact", head: true })
      .eq("status", "submitted")
      .eq("current_stage", stage);
    if (profile?.role === "site_supervisor") {
      countQuery = countQuery.eq("supervisor_id", user.id);
    }
    const { count } = await countQuery;
    approvalsBadge = count ?? 0;
  }

  // 請假待簽 badge — 對應 role 在 current_step 的 pending 請假筆數(排除自己送的)
  let leavesBadge = 0;
  if (profile?.role && profile.role !== "field_assistant") {
    const { count } = await supabase
      .from("leave_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .eq("current_step", profile.role)
      .neq("applicant_id", user.id);
    leavesBadge = count ?? 0;
  }

  const { desktopNav, mobileTabs } = navByRole(
    profile?.role,
    approvalsBadge,
    leavesBadge,
  );

  return (
    <div className="flex min-h-screen flex-col">
      <RouteProgress />
      <header className="border-b border-[#E0DCD6] bg-primary text-primary-foreground">
        <div className="flex h-16 items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-8">
            <Link
              href="/"
              className="flex items-center gap-3 text-lg font-semibold tracking-wider"
            >
              <Image
                src="/yumin-badge-white.svg"
                alt=""
                width={24}
                height={34}
                priority
                className="h-8 w-auto"
              />
              裕民工務 管理系統
            </Link>
            {desktopNav.length > 0 && (
              <nav className="hidden items-center gap-6 text-base text-[#E8E4DE] md:flex">
                {desktopNav.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="inline-flex items-center gap-1.5 hover:text-white"
                  >
                    <span>{l.label}</span>
                    {l.badge !== undefined && l.badge > 0 && (
                      <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-[#B91C1C] px-1.5 py-0 text-xs font-semibold tabular-nums leading-5 text-white">
                        {l.badge}
                      </span>
                    )}
                  </Link>
                ))}
              </nav>
            )}
          </div>

          <div className="flex items-center gap-4 text-sm">
            <Link
              href="/account"
              className="hidden text-right md:block hover:opacity-90"
              title="我的帳號 / 修改密碼"
            >
              <div className="text-base text-[#E8E4DE] underline-offset-4 hover:underline">
                {fullName}
              </div>
              <div className="text-sm text-[#A07850]">
                {company} · {roleLabel}
              </div>
            </Link>
            {/* 手機版:小頭像連結 — 點開到 /account 改密碼 / 看身份。
                桌機版上方那塊 Link 已負責,所以這顆 md:hidden。 */}
            <Link
              href="/account"
              aria-label="我的帳號"
              title="我的帳號"
              className="inline-flex size-9 items-center justify-center rounded-full border border-[#A07850]/40 text-[#E8E4DE] transition-colors hover:bg-white/5 md:hidden"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </Link>
            <form action={logoutAction}>
              <LogoutButton />
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 pt-6 pb-24 md:px-8 md:py-10 lg:px-12">
        {children}
      </main>

      <BottomTabNav tabs={mobileTabs} />
    </div>
  );
}

function navByRole(
  role: string | undefined,
  approvalsBadge: number,
  leavesBadge: number,
): {
  desktopNav: DesktopLink[];
  mobileTabs: BottomTab[];
} {
  // 請假 desktop 連結 — 所有角色都看得到(label 帶 badge);field_assistant 沒有簽人,但要能送
  const leavesLink: DesktopLink = {
    href: "/leaves",
    label: "請假",
    badge: leavesBadge,
  };

  switch (role) {
    case "site_supervisor":
      return {
        desktopNav: [
          { href: "/logs", label: "日誌" },
          { href: "/approvals", label: "待複核", badge: approvalsBadge },
          { href: "/approvals/history", label: "我簽過的" },
          { href: "/attendance", label: "打卡" },
          { href: "/field-reports", label: "現場回報" },
          { href: "/my-cases", label: "我的案場" },
          leavesLink,
          { href: "/cases", label: "案件總覽" },
          { href: "/reports", label: "報表" },
        ],
        // 手機:核心 4 個 tab。案件總覽在桌機 nav 可看,手機則透過日誌/打卡 → 案件 link 進入。
        mobileTabs: [
          { href: "/attendance", label: "打卡", icon: "clock" },
          { href: "/logs", label: "日誌", icon: "file" },
          { href: "/approvals", label: "待複核", icon: "check" },
          { href: "/field-reports", label: "回報", icon: "camera" },
        ],
      };
    case "owner":
      return {
        desktopNav: [
          { href: "/dashboard", label: "儀表板" },
          { href: "/approvals", label: "待核定", badge: approvalsBadge },
          { href: "/approvals/history", label: "我簽過的" },
          { href: "/cases", label: "案件總覽" },
          { href: "/logs", label: "日誌" },
          { href: "/field-reports", label: "現場回報" },
          leavesLink,
          { href: "/reports", label: "報表" },
          { href: "/staff", label: "人員管理" },
        ],
        mobileTabs: [
          { href: "/dashboard", label: "首頁", icon: "home" },
          { href: "/approvals", label: "待核定", icon: "check" },
          { href: "/cases", label: "案件", icon: "folder" },
          { href: "/logs", label: "日誌", icon: "file" },
          { href: "/staff", label: "人員", icon: "users" },
        ],
      };
    case "field_assistant":
      return {
        desktopNav: [
          { href: "/attendance", label: "打卡" },
          { href: "/my-cases", label: "我的案場" },
          { href: "/field-reports", label: "我的回報" },
          { href: "/field-reports/new", label: "新增回報" },
          leavesLink,
        ],
        mobileTabs: [
          { href: "/attendance", label: "打卡", icon: "clock" },
          { href: "/my-cases", label: "案場", icon: "folder" },
          { href: "/field-reports", label: "回報", icon: "list" },
          { href: "/field-reports/new", label: "新增", icon: "plus" },
          { href: "/leaves", label: "請假", icon: "clock" },
        ],
      };
    case "office_staff":
      return {
        desktopNav: [
          { href: "/dashboard", label: "儀表板" },
          { href: "/cases", label: "案件總覽" },
          { href: "/approvals", label: "待審核", badge: approvalsBadge },
          { href: "/approvals/history", label: "我簽過的" },
          { href: "/logs", label: "日誌" },
          { href: "/field-reports", label: "現場回報" },
          leavesLink,
          { href: "/reports", label: "報表" },
          { href: "/staff", label: "人員管理" },
        ],
        mobileTabs: [
          { href: "/dashboard", label: "首頁", icon: "home" },
          { href: "/cases", label: "案件", icon: "folder" },
          { href: "/approvals", label: "待審核", icon: "check" },
          { href: "/field-reports", label: "現場", icon: "camera" },
          { href: "/staff", label: "人員", icon: "users" },
        ],
      };
    default:
      return { desktopNav: [], mobileTabs: [] };
  }
}
