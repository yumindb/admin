import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import { BottomTabNav, type BottomTab } from "@/components/bottom-tab-nav";
import { LogoutButton } from "@/components/logout-button";
import { RouteProgress } from "@/components/route-progress";
import { RoleWelcomeCard } from "@/components/role-welcome-card";
import { logoutAction } from "../login/actions";
import { getCompanyShort } from "@/lib/companies";
import { emailToUsername } from "@/lib/auth/username";
import { countUnreadMessages } from "@/lib/notifications/messages";

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
  // actor 走 require-role 的 cache() 版本 — 同一個 request 內 layout 與 page
  // 共用同一次 auth 驗證 + profile 查詢,不會各查一遍。
  const actor = await tryGetActor();
  if (!actor) {
    redirect("/login");
  }

  const supabase = await createClient();
  const fullName = actor.fullName ?? emailToUsername(actor.email ?? undefined) ?? "未命名使用者";
  const roleLabel = ROLE_LABEL[actor.role] ?? actor.role;
  const company = getCompanyShort(actor.company ?? "裕民");

  // 兩個 badge 彼此無關 — 平行跑,不要排隊等對方
  const stageForRole: Record<string, "review" | "audit" | "approve" | null> = {
    site_supervisor: "review",
    office_staff: "audit",
    owner: "approve",
    field_assistant: null,
  };
  const stage = stageForRole[actor.role] ?? null;

  const approvalsCountPromise = stage
    ? (() => {
        let q = supabase
          .from("daily_logs")
          .select("id", { count: "exact", head: true })
          .eq("status", "submitted")
          .eq("current_stage", stage);
        if (actor.role === "site_supervisor") {
          q = q.eq("supervisor_id", actor.id);
        }
        return q;
      })()
    : null;

  // 請假待簽 badge — 對應 role 在 current_step 的 pending 請假筆數(排除自己送的)
  const leavesCountPromise =
    actor.role !== "field_assistant"
      ? supabase
          .from("leave_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending")
          .eq("current_step", actor.role)
          .neq("applicant_id", actor.id)
      : null;

  const [approvalsRes, leavesRes, unreadMessages] = await Promise.all([
    approvalsCountPromise,
    leavesCountPromise,
    // 站內消息未讀數(2026-08:簽核意見要在 App 裡看得到)。
    // partial index (profile_id) where read_at is null,查詢很輕;
    // migration-2.33 還沒跑時回 0,不會讓整個 layout 掛掉。
    countUnreadMessages(supabase, actor.id),
  ]);
  const approvalsBadge = approvalsRes?.count ?? 0;
  const leavesBadge = leavesRes?.count ?? 0;

  const { desktopNav, mobileTabs } = navByRole(
    actor.role,
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
            {/* 消息 — 簽核意見 / 退回原因的站內通道(不需綁 LINE)。
                全角色、手機桌機都放這顆:業主 2026-08「底下的人不會跳通知出來」
                的解法就是這個紅點。有未讀時鈴鐺會閃。 */}
            <Link
              href="/messages"
              aria-label={
                unreadMessages > 0 ? `消息（${unreadMessages} 則未讀）` : "消息"
              }
              title="消息"
              className="relative inline-flex size-9 items-center justify-center rounded-full border border-[#A07850]/40 text-[#E8E4DE] transition-colors hover:bg-white/5"
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
                className={unreadMessages > 0 ? "animate-pulse" : undefined}
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unreadMessages > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-[#B91C1C] px-1 text-[11px] font-semibold tabular-nums leading-[1.15rem] text-white">
                  {unreadMessages > 99 ? "99+" : unreadMessages}
                </span>
              )}
            </Link>
            {/* 使用說明 — 全角色、全裝置都看得到的求助入口(公開靜態頁,開新分頁) */}
            <a
              href="/manual.html"
              target="_blank"
              rel="noopener"
              aria-label="使用說明"
              title="使用說明"
              className="inline-flex size-9 items-center justify-center rounded-full border border-[#A07850]/40 text-[#E8E4DE] transition-colors hover:bg-white/5"
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
                <circle cx="12" cy="12" r="10" />
                <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </a>
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
            {/* 手機版：小頭像連結 — 點開到 /account 改密碼 / 看身份。
                桌機版上方那塊 Link 已負責，所以這顆 md:hidden。 */}
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

      {/* 首次登入依角色彈一次「最基本要做的事」小卡(依帳號記憶,可選以後不再顯示) */}
      <RoleWelcomeCard role={actor.role} fullName={fullName} userId={actor.id} />
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
        // 2026-07-07:老闆手機版原本沒有「回報」入口(桌機 nav 有、頁面權限也開,
        // 只漏了 tab),Phil 在手機上等於看不到也不能建現場回報 — 補上,共 6 tab。
        mobileTabs: [
          { href: "/dashboard", label: "首頁", icon: "home" },
          { href: "/approvals", label: "待核定", icon: "check" },
          { href: "/cases", label: "案件", icon: "folder" },
          { href: "/logs", label: "日誌", icon: "file" },
          { href: "/field-reports", label: "回報", icon: "camera" },
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
