import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTW } from "@/lib/datetime";

/**
 * 現場人員專屬「我的案場」頁。
 *
 * 痛點 (現場人員視角測試):
 *   - 中午要回報時不知道主任今天派我去哪
 *   - layout nav 只給 3 個 tab,看不到案場資訊
 *
 * 設計取捨:不做「主任預派」(需新 schema + 主任端入口),
 * 改撈最近 14 天 user 自己的打卡與回報記錄 — 那是 ground truth,
 * 員工昨天去過的案場 = 今天大機率還會去。
 *
 * 顯示:案件名 / 案號 / 地址 / 上次去過 X 天前 / 快速「打卡」「新增回報」按鈕。
 */
export default async function MyCasesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  // 這頁主要給 field_assistant + supervisor 看,owner / office_staff 用「案件總覽」更全
  if (profile?.role === "owner" || profile?.role === "office_staff") {
    redirect("/cases");
  }

  // 最近 14 天的打卡 + 回報,撈 case_id 即可
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const sinceIso = fourteenDaysAgo.toISOString();

  const [{ data: attendance }, { data: reports }] = await Promise.all([
    supabase
      .from("attendance_events")
      .select("case_id, created_at")
      .eq("user_id", user.id)
      .gte("created_at", sinceIso)
      .not("case_id", "is", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("field_reports")
      .select("case_id, created_at")
      .eq("author_id", user.id)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false }),
  ]);

  // 每個 case 取最新一次接觸時間
  const lastSeenByCase = new Map<string, string>();
  for (const r of attendance ?? []) {
    const cid = r.case_id as string | null;
    if (!cid) continue;
    if (!lastSeenByCase.has(cid)) {
      lastSeenByCase.set(cid, r.created_at as string);
    }
  }
  for (const r of reports ?? []) {
    const cid = r.case_id as string | null;
    if (!cid) continue;
    const existing = lastSeenByCase.get(cid);
    if (!existing || (r.created_at as string) > existing) {
      lastSeenByCase.set(cid, r.created_at as string);
    }
  }

  const caseIds = Array.from(lastSeenByCase.keys());

  // 撈案件 metadata
  const { data: cases } = caseIds.length
    ? await supabase
        .from("cases")
        .select("id, code, name, location, status, lat, lng")
        .in("id", caseIds)
    : { data: [] };

  const caseRows = (cases ?? [])
    .map((c) => ({
      id: c.id as string,
      code: c.code as string | null,
      name: c.name as string,
      location: c.location as string | null,
      status: c.status as string,
      lat: c.lat as number | null,
      lng: c.lng as number | null,
      lastSeen: lastSeenByCase.get(c.id as string) ?? null,
    }))
    .sort((a, b) => {
      // active 案件排前面,然後依 lastSeen 由近到遠
      if (a.status !== b.status) {
        if (a.status === "active") return -1;
        if (b.status === "active") return 1;
      }
      if (!a.lastSeen) return 1;
      if (!b.lastSeen) return -1;
      return b.lastSeen.localeCompare(a.lastSeen);
    });

  const now = Date.now();
  function daysAgo(iso: string | null): number | null {
    if (!iso) return null;
    const ms = now - new Date(iso).getTime();
    return Math.floor(ms / (24 * 60 * 60 * 1000));
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-primary md:text-3xl">
          我的案場
        </h1>
        <p className="mt-1.5 text-base text-muted-foreground">
          最近 14 天你打卡或回報過的案場，依最近接觸時間排序。
        </p>
      </div>

      {caseRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-16 text-center">
          <p className="mb-2 text-base text-foreground">
            最近 14 天還沒有打卡或回報紀錄
          </p>
          <p className="mb-5 text-sm text-muted-foreground">
            到工地後先打卡，系統就會記住你接觸過哪些案場。
          </p>
          <Link
            href="/attendance"
            className="inline-flex h-12 items-center rounded-md bg-primary px-5 text-base font-medium text-primary-foreground hover:bg-primary/90"
          >
            去打卡
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {caseRows.map((c) => {
            const d = daysAgo(c.lastSeen);
            const recencyLabel =
              d === null
                ? "—"
                : d === 0
                  ? "今天去過"
                  : d === 1
                    ? "昨天去過"
                    : `${d} 天前去過`;
            const recencyTone =
              d !== null && d <= 1
                ? "bg-[#ECFDF5] text-[#15803D] border-[#A7D7B1]"
                : "bg-[#F5F1EC] text-foreground border-[#E0DCD6]";
            return (
              <li
                key={c.id}
                className="rounded-lg border border-[#E0DCD6] bg-card p-4 transition-colors hover:border-accent"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-muted-foreground">
                      {c.code ?? "未編號"}
                    </div>
                    <div className="mt-0.5 text-lg font-semibold text-primary">
                      {c.name}
                      {c.status === "paused" && (
                        <span className="ml-2 rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 text-xs text-[#92400E]">
                          暫停
                        </span>
                      )}
                      {c.status === "closed" && (
                        <span className="ml-2 rounded-full border border-[#E5E7EB] bg-[#F3F4F6] px-2 py-0.5 text-xs text-muted-foreground">
                          已結案
                        </span>
                      )}
                    </div>
                    {c.location && (
                      <div className="mt-1 text-sm text-muted-foreground">
                        📍 {c.location}
                      </div>
                    )}
                    {c.lastSeen && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        最近 {formatDateTW(c.lastSeen)}
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${recencyTone}`}
                  >
                    {recencyLabel}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={`/attendance`}
                    className="inline-flex h-11 items-center rounded-md border border-primary px-4 text-sm text-primary hover:bg-primary/5"
                  >
                    打卡
                  </Link>
                  <Link
                    href={`/field-reports/new?case=${c.id}`}
                    className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground hover:bg-primary/90"
                  >
                    新增回報
                  </Link>
                  {c.lat !== null && c.lng !== null && (
                    <a
                      href={`https://www.google.com/maps?q=${c.lat},${c.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-11 items-center rounded-md border border-[#E0DCD6] bg-white px-4 text-sm text-foreground hover:border-accent"
                    >
                      🗺 地圖
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
