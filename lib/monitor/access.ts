import { notFound, redirect } from "next/navigation";
import { tryGetActor, type Actor } from "@/lib/auth/require-role";
import { emailToUsername } from "@/lib/auth/username";

/**
 * 系統監控頁(常用操作 / 慢請求 / 錯誤紀錄)只給「系統管理者」看 —
 * 目前就是顧問 Evelyn。名單放在伺服器環境變數,不是資料庫角色:
 *
 *   SYSTEM_ADMIN_USERNAMES=帳號1,帳號2   (帳號 = 登入用的 username,逗號分隔)
 *
 * - 名單外的人看不到任何入口,直接打網址也只會得到 404(不透露有這幾頁)
 * - 沒設定 = 沒有人看得到(寧可關著也不要誤開)
 * - 改名單要到 Vercel → Settings → Environment Variables,改完 redeploy 才生效
 */
export function isSystemAdmin(actor: Pick<Actor, "email"> | null | undefined): boolean {
  const username = emailToUsername(actor?.email)?.toLowerCase();
  if (!username) return false;
  return (process.env.SYSTEM_ADMIN_USERNAMES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(username);
}

/** 監控頁開頭呼叫:未登入 → /login;不在名單 → 404 */
export async function requireSystemAdmin(): Promise<Actor> {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (!isSystemAdmin(actor)) notFound();
  return actor;
}
