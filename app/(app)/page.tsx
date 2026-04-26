import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// 角色導向首頁:
//   site_supervisor → /logs
//   owner          → /approvals(待核定)
//   office_staff   → /cases(案件總覽)
//   未登入或未知   → /cases(案件總覽,layout 已擋未登入)
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role === "site_supervisor") redirect("/logs");
    if (profile?.role === "owner") redirect("/approvals");
  }
  redirect("/cases");
}
