import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logoutAction } from "../login/actions";

const ROLE_LABEL: Record<string, string> = {
  office_staff: "辦公室助理",
  site_supervisor: "工地主任",
  owner: "老闆",
};

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

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 items-center justify-between border-b border-[#E0DCD6] bg-primary px-4 text-primary-foreground md:px-8">
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
          <nav className="hidden items-center gap-6 text-base text-[#E8E4DE] md:flex">
            {profile?.role === "site_supervisor" ? (
              <>
                <Link href="/logs" className="hover:text-white">
                  我的日誌
                </Link>
                <Link href="/approvals" className="hover:text-white">
                  待複核
                </Link>
                <Link href="/" className="hover:text-white">
                  案件
                </Link>
              </>
            ) : profile?.role === "owner" ? (
              <>
                <Link href="/approvals" className="hover:text-white">
                  待核定
                </Link>
                <Link href="/" className="hover:text-white">
                  案件
                </Link>
                <Link href="/logs" className="hover:text-white">
                  施工日誌
                </Link>
              </>
            ) : (
              <>
                <Link href="/" className="hover:text-white">
                  案件
                </Link>
                <Link href="/approvals" className="hover:text-white">
                  待審核
                </Link>
                <Link href="/logs" className="hover:text-white">
                  施工日誌
                </Link>
              </>
            )}
          </nav>
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
      </header>

      <main className="flex-1 px-4 py-6 md:px-8 md:py-10 lg:px-12">
        {children}
      </main>
    </div>
  );
}
