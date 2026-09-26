import { redirect } from "next/navigation";
import { tryGetActor } from "@/lib/auth/require-role";

// 角色導向首頁(也是手機加到主畫面後的啟動頁,每次開 App 都會經過):
//   site_supervisor → /logs
//   owner          → /dashboard
//   reviewer       → /approvals(加簽清單)
//   field_assistant → /field-reports(現場回報清單)
//   office_staff   → /dashboard
//   未登入或未知   → /cases(案件總覽,layout 已擋未登入)
// 走共用的 tryGetActor(已包 cache,layout 算過就不再查)— 以前這裡自己 getUser() 再撈 profile。
export default async function HomePage() {
  const actor = await tryGetActor();
  if (actor?.role === "site_supervisor") redirect("/logs");
  if (actor?.role === "owner") redirect("/dashboard");
  if (actor?.role === "reviewer") redirect("/approvals");
  if (actor?.role === "field_assistant") redirect("/field-reports");
  if (actor?.role === "office_staff") redirect("/dashboard");
  redirect("/cases");
}
