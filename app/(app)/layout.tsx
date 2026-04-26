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
      <header className="flex h-14 items-center justify-between border-b border-[#E0DCD6] bg-primary px-6 text-primary-foreground">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-base font-semibold tracking-wider"
          >
            <Image
              src="/yumin-badge-white.svg"
              alt=""
              width={22}
              height={31}
              priority
              className="h-7 w-auto"
            />
            裕民工務 管理系統
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-[#E8E4DE] md:flex">
            <Link href="/" className="hover:text-white">
              案件
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="hidden text-right md:block">
            <div className="text-[#E8E4DE]">{fullName}</div>
            <div className="text-xs text-[#A07850]">
              {company} · {roleLabel}
            </div>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-[#A07850]/40 px-3 py-1.5 text-xs text-[#E8E4DE] transition-colors hover:bg-white/5"
            >
              登出
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 px-6 py-8 md:px-10">{children}</main>
    </div>
  );
}
