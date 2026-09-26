import { redirect } from "next/navigation";
import { requireSystemAdmin } from "@/lib/monitor/access";

/** /system → 常用操作(名單外的人在 requireSystemAdmin 就拿到 404) */
export default async function SystemHomePage() {
  await requireSystemAdmin();
  redirect("/system/usage");
}
