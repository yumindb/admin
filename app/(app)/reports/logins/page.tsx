import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { createServiceClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import { emailToUsername } from "@/lib/auth/username";
import { formatTW } from "@/lib/datetime";

export const dynamic = "force-dynamic";

/**
 * /reports/logins — 登入紀錄(僅 office_staff / owner)。
 *
 * 資料來自 login_attempts(migration-2.17 起每次登入成功/失敗都寫一筆;
 * migration-2.25 加 user_agent / ip)。RLS 全擋,這頁走 service client
 * (與 /staff 同模式),頁面本身先驗角色。
 *
 * retention: 失敗 30 天、成功 365 天(lib/retention.ts),所以「誰登入過」
 * 可回看一年,失敗雜訊一個月自然過期。
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DAY_OPTIONS = [7, 30, 90] as const;

type AttemptRow = {
  id: string;
  email: string;
  attempted_at: string;
  success: boolean;
  user_agent?: string | null;
  ip?: string | null;
};

/** UA → 給人看的裝置標籤。純 heuristic,認不出就顯示「其他」。 */
function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "—";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows 電腦";
  if (/Macintosh/i.test(ua)) return "Mac";
  return "其他";
}

export default async function LoginRecordsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role !== "office_staff" && actor.role !== "owner") redirect("/");

  const sp = await searchParams;
  const days = DAY_OPTIONS.includes(Number(sp.days) as (typeof DAY_OPTIONS)[number])
    ? Number(sp.days)
    : 30;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const failOnly = sp.result === "fail";

  const admin = createServiceClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // migration-2.25 未跑時 select 明列 user_agent/ip 會整包失敗 → 用 * 容錯
  const [{ data: attempts, error: attemptsError }, { data: profiles }, { data: usersList }] =
    await Promise.all([
      admin
        .from("login_attempts")
        .select("*")
        .gte("attempted_at", since)
        .order("attempted_at", { ascending: false })
        .limit(500),
      admin.from("profiles").select("id, full_name"),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

  const nameById = new Map<string, string | null>();
  for (const p of profiles ?? []) nameById.set(p.id as string, (p.full_name as string) ?? null);
  const infoByEmail = new Map<string, { fullName: string | null }>();
  for (const u of usersList?.users ?? []) {
    if (u.email) infoByEmail.set(u.email.toLowerCase(), { fullName: nameById.get(u.id) ?? null });
  }

  const rows = ((attempts ?? []) as AttemptRow[]).map((a) => {
    const username = emailToUsername(a.email) ?? a.email;
    const fullName = infoByEmail.get(a.email.toLowerCase())?.fullName ?? null;
    return { ...a, username, fullName };
  });

  // 連續失敗警示:對每個帳號,從最新一筆往回數連續失敗;>= 3 就列出來
  const streakByEmail = new Map<string, number>();
  const seenSuccess = new Set<string>();
  for (const r of rows) {
    // rows 已依時間新→舊排序
    if (seenSuccess.has(r.email)) continue;
    if (r.success) {
      seenSuccess.add(r.email);
    } else {
      streakByEmail.set(r.email, (streakByEmail.get(r.email) ?? 0) + 1);
    }
  }
  const suspicious = [...streakByEmail.entries()]
    .filter(([, n]) => n >= 3)
    .map(([email, n]) => ({ username: emailToUsername(email) ?? email, n }));

  const filtered = rows.filter((r) => {
    if (failOnly && r.success) return false;
    if (!q) return true;
    return (
      r.username.toLowerCase().includes(q) ||
      (r.fullName ?? "").toLowerCase().includes(q)
    );
  });

  const pillHref = (nextDays: number, nextFailOnly: boolean) => {
    const params = new URLSearchParams();
    if (nextDays !== 30) params.set("days", String(nextDays));
    if (nextFailOnly) params.set("result", "fail");
    if (q) params.set("q", q);
    const s = params.toString();
    return s ? `/reports/logins?${s}` : "/reports/logins";
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-primary md:text-3xl">登入紀錄</h1>
        <p className="mt-1.5 text-base text-muted-foreground">
          每次登入（成功與失敗）都會留下時間、裝置與來源 — 成功紀錄保留一年、失敗紀錄保留 30 天
        </p>
      </div>

      {suspicious.length > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-600" strokeWidth={1.75} />
          <div className="text-sm text-red-800">
            <p className="font-semibold">
              有帳號連續登入失敗，可能是忘記密碼或有人嘗試猜密碼：
            </p>
            <ul className="mt-1 list-inside list-disc">
              {suspicious.map((s) => (
                <li key={s.username}>
                  <span className="font-mono">{s.username}</span> — 最近連續失敗 {s.n} 次
                </li>
              ))}
            </ul>
            <p className="mt-1 text-red-700">
              連續失敗 3 次會自動鎖定 15 分鐘。若確認是本人忘記密碼，可到「人員管理」重設。
            </p>
          </div>
        </div>
      )}

      {/* 篩選列 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {DAY_OPTIONS.map((d) => (
          <Link
            key={d}
            href={pillHref(d, failOnly)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              days === d
                ? "border-primary bg-primary text-primary-foreground"
                : "border-[#E0DCD6] bg-card text-muted-foreground hover:border-accent"
            }`}
          >
            近 {d} 天
          </Link>
        ))}
        <span className="mx-1 h-5 w-px bg-[#E0DCD6]" />
        <Link
          href={pillHref(days, !failOnly)}
          className={`rounded-full border px-3 py-1.5 text-sm ${
            failOnly
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-[#E0DCD6] bg-card text-muted-foreground hover:border-accent"
          }`}
        >
          只看失敗
        </Link>
        <form action="/reports/logins" className="ml-auto flex items-center gap-2">
          {days !== 30 && <input type="hidden" name="days" value={days} />}
          {failOnly && <input type="hidden" name="result" value="fail" />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="搜尋帳號或姓名"
            className="h-10 w-44 rounded-md border border-[#E0DCD6] bg-card px-3 text-sm outline-none focus:border-accent md:w-56"
          />
        </form>
      </div>

      {attemptsError ? (
        <p className="rounded-md border border-[#E0DCD6] bg-card p-6 text-sm text-muted-foreground">
          讀取登入紀錄失敗：{attemptsError.message}
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-md border border-[#E0DCD6] bg-card p-6 text-sm text-muted-foreground">
          這段期間沒有符合條件的登入紀錄。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#E0DCD6] bg-card">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-[#E0DCD6] bg-[#F5F1EC] text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">時間</th>
                <th className="px-4 py-3 font-medium">帳號</th>
                <th className="px-4 py-3 font-medium">結果</th>
                <th className="px-4 py-3 font-medium">裝置</th>
                <th className="px-4 py-3 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-[#E0DCD6]/60 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                    {formatTW(r.attempted_at, {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono">{r.username}</span>
                    {r.fullName && (
                      <span className="ml-2 text-muted-foreground">{r.fullName}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.success ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                        成功
                      </span>
                    ) : (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
                        失敗
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">{deviceLabel(r.user_agent)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {r.ip ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length >= 500 && (
            <p className="border-t border-[#E0DCD6] px-4 py-2.5 text-xs text-muted-foreground">
              僅顯示最近 500 筆，縮短天數或用搜尋可看得更精準。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
