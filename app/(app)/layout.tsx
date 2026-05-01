import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomTabNav, type BottomTab } from "@/components/bottom-tab-nav";
import { logoutAction } from "../login/actions";

const ROLE_LABEL: Record<string, string> = {
  office_staff: "辦公室助理",
  site_supervisor: "工地主任",
  owner: "老闆",
  field_assistant: "現場助理",
};

type DesktopLink = { href: string; label: string };

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

  const fullName = profile?.full_name ?? user.email ?? "未命名使用者";
  const roleLabel = profile?.role ? ROLE_LABEL[profile.role] ?? profile.role : "—";
  const company = profile?.company ?? "裕民";

  const { desktopNav, mobileTabs } = navByRole(profile?.role);

  return (
    <div className="flex min-h-screen flex-col">
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
                  <Link key={l.href} href={l.href} className="hover:text-white">
                    {l.label}
                  </Link>
                ))}
              </nav>
            )}
          </div>

          <div className="flex items-center gap-4 text-sm">
            <div className="hidden text-right md:block">
              <div className="text-base text-[#E8E4DE]">{fullName}</div>
              <div className="text-sm text-[#A07850]">
                {company} · {roleLabel}
              </div>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-md border border-[#A07850]/40 px-3 py-2 text-sm text-[#E8E4DE] transition-colors hover:bg-white/5"
              >
                登出
              </button>
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

function navByRole(role: string | undefined): {
  desktopNav: DesktopLink[];
  mobileTabs: BottomTab[];
} {
  switch (role) {
    case "site_supervisor":
      return {
        desktopNav: [
          { href: "/logs", label: "日誌" },
          { href: "/approvals", label: "待複核" },
          { href: "/field-reports", label: "現場回報" },
          { href: "/cases", label: "案件總覽" },
        ],
        mobileTabs: [
          { href: "/logs", label: "日誌", icon: "file" },
          { href: "/approvals", label: "待複核", icon: "check" },
          { href: "/field-reports", label: "現場回報", icon: "camera" },
          { href: "/cases", label: "案件", icon: "folder" },
        ],
      };
    case "owner":
      return {
        desktopNav: [
          { href: "/approvals", label: "待核定" },
          { href: "/cases", label: "案件總覽" },
          { href: "/logs", label: "日誌" },
          { href: "/field-reports", label: "現場回報" },
          { href: "/staff", label: "人員管理" },
        ],
        mobileTabs: [
          { href: "/approvals", label: "待核定", icon: "check" },
          { href: "/cases", label: "案件", icon: "folder" },
          { href: "/logs", label: "日誌", icon: "file" },
          { href: "/field-reports", label: "現場", icon: "camera" },
          { href: "/staff", label: "人員", icon: "users" },
        ],
      };
    case "field_assistant":
      return {
        desktopNav: [
          { href: "/field-reports", label: "我的回報" },
          { href: "/field-reports/new", label: "新增回報" },
        ],
        mobileTabs: [
          { href: "/field-reports", label: "我的回報", icon: "list" },
          { href: "/field-reports/new", label: "新增回報", icon: "plus" },
        ],
      };
    case "office_staff":
      return {
        desktopNav: [
          { href: "/cases", label: "案件總覽" },
          { href: "/approvals", label: "待審核" },
          { href: "/logs", label: "日誌" },
          { href: "/staff", label: "人員管理" },
        ],
        mobileTabs: [
          { href: "/cases", label: "案件", icon: "folder" },
          { href: "/approvals", label: "待審核", icon: "check" },
          { href: "/logs", label: "日誌", icon: "file" },
          { href: "/staff", label: "人員", icon: "users" },
        ],
      };
    default:
      return { desktopNav: [], mobileTabs: [] };
  }
}
