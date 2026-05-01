import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { BulkPdfDownloadButton } from "@/components/bulk-pdf-download-button";
import { formatWeatherSummary } from "@/lib/daily-log";
import type { DailyLog, LogStatus } from "@/lib/types";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]" },
  submitted: { label: "簽核中", cls: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]" },
  approved: { label: "已核定", cls: "bg-[#ECFDF5] text-[#4A7C59] border-[#A7F3D0]" },
  rejected: { label: "已退回", cls: "bg-[#FEF2F2] text-[#B91C1C] border-[#FCA5A5]" },
};

const STAGE_LABEL_SHORT: Record<string, string> = {
  fill: "填表",
  review: "複核",
  audit: "審核",
  approve: "核定",
};

type LogRow = DailyLog & { cases: { name: string; code: string | null } | null };

type CaseGroup = {
  caseId: string;
  caseName: string;
  caseCode: string | null;
  logs: LogRow[];
  latestDate: string;
  counts: Record<LogStatus, number>;
};

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // supervisor 只看自己;office_staff/owner 看全部 (POC RLS allow all but UX 上 supervisor 只想看自己)
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .maybeSingle();

  const sp = await searchParams;
  const caseFilterId = sp.case ?? null;

  let query = supabase
    .from("daily_logs")
    .select("*, cases(name, code)")
    .order("log_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (profile?.role === "site_supervisor") {
    query = query.eq("supervisor_id", user!.id);
  }
  if (caseFilterId) {
    query = query.eq("case_id", caseFilterId);
  }

  const { data: logs, error } = await query;
  const list = (logs ?? []) as LogRow[];

  const isSupervisor = profile?.role === "site_supervisor";
  const isOfficeStaff = profile?.role === "office_staff";
  const canCreateLog = isSupervisor || profile?.role === "owner";

  const groups = groupByCase(list);
  const filteredCaseName =
    caseFilterId && groups.length > 0 ? groups[0].caseName : null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary md:text-3xl">
            {isSupervisor ? "我的日誌" : isOfficeStaff ? "施工日誌審核總覽" : "施工日誌"}
          </h1>
          <p className="mt-1.5 text-base text-muted-foreground">
            {isSupervisor ? "依案件分組,點開查看每天的日誌" : isOfficeStaff ? "辦公室助理可查看全部日誌與簽核狀態" : "依案件分組,點開查看每天的日誌"}
          </p>
        </div>
        {/* 桌機:右上角按鈕 */}
        {canCreateLog && (
          <Button
            asChild
            size="lg"
            className="hidden bg-primary text-primary-foreground hover:bg-primary/90 md:inline-flex"
          >
            <Link href="/logs/new">+ 新日誌</Link>
          </Button>
        )}
      </div>

      {caseFilterId && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-md border border-[#E0DCD6] bg-[#FAF7F2] px-4 py-3 text-sm">
          <span className="text-muted-foreground">已篩選案件:</span>
          <span className="font-medium text-foreground">
            {filteredCaseName ?? "(查無對應案件)"}
          </span>
          <Link
            href="/logs"
            className="ml-auto text-sm text-accent hover:underline"
          >
            清除篩選
          </Link>
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          載入失敗:{error.message}
        </p>
      )}

      {!list.length ? (
        <Empty isSupervisor={isSupervisor} />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const hasActionable = g.counts.draft + g.counts.submitted > 0;
            return (
              <details
                key={g.caseId}
                open={hasActionable}
                className="group rounded-lg border border-[#E0DCD6] bg-card transition-colors hover:border-accent open:border-[#D4CFC8]"
              >
                <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-5 md:p-6 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{g.caseCode ?? "未編號"}</span>
                      <span>·</span>
                      <span>共 {g.logs.length} 筆</span>
                      <span>·</span>
                      <span>最後一筆 {new Date(g.latestDate).toLocaleDateString("zh-TW")}</span>
                    </div>
                    <h3 className="truncate text-lg font-semibold text-primary md:text-xl">
                      {g.caseName}
                    </h3>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {(["draft", "submitted", "approved", "rejected"] as LogStatus[])
                        .filter((s) => g.counts[s] > 0)
                        .map((s) => (
                          <span
                            key={s}
                            className={`rounded-full border px-2 py-0.5 text-xs ${STATUS[s].cls}`}
                          >
                            {STATUS[s].label} {g.counts[s]}
                          </span>
                        ))}
                    </div>
                  </div>
                  <div className="mt-1 flex shrink-0 items-start gap-3">
                    {g.counts.approved > 0 && (
                      <BulkPdfDownloadButton
                        logIds={g.logs
                          .filter((l) => l.status === "approved")
                          .map((l) => l.id)}
                        label={`下載 ${g.counts.approved} 份 PDF`}
                      />
                    )}
                    <span className="text-muted-foreground transition-transform group-open:rotate-180">
                      <ChevronDown />
                    </span>
                  </div>
                </summary>
                <div className="border-t border-[#E0DCD6]">
                  <ul>
                    {g.logs.map((l, idx) => {
                      const s = STATUS[l.status] ?? STATUS.draft;
                      return (
                        <li key={l.id}>
                          <Link
                            href={`/logs/${l.id}`}
                            className={`flex items-start justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-[#F5F1EC] md:px-6 ${
                              idx > 0 ? "border-t border-[#F0EBE4]" : ""
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 text-sm text-foreground">
                                <span className="font-medium">
                                  {new Date(l.log_date).toLocaleDateString("zh-TW")}
                                </span>
                                {l.weather && (
                                  <span className="text-xs text-muted-foreground">
                                    · {formatWeatherSummary(l.weather)}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>{l.work_items?.length ?? 0} 工項</span>
                                <span>{l.photos?.length ?? 0} 照片</span>
                                {l.notes && (
                                  <span className="line-clamp-1 max-w-[20rem]">📝 {l.notes}</span>
                                )}
                              </div>
                            </div>
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${s.cls}`}
                            >
                              {s.label}
                              {l.status === "submitted" && l.current_stage
                                ? `:${STAGE_LABEL_SHORT[l.current_stage]}`
                                : ""}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </details>
            );
          })}
        </div>
      )}

      {/* 手機 extended FAB:浮在右下,坐在底部 tab bar 上方。
          兩個會建日誌的角色(site_supervisor / owner)都有底部 tab,
          所以 FAB 都要 fixed 並設 bottom 含 safe-area。 */}
      {canCreateLog && (
        <Link
          href="/logs/new"
          aria-label="新日誌"
          className="fixed right-4 z-30 inline-flex h-14 items-center gap-1.5 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground shadow-lg transition-transform active:scale-95 md:hidden"
          style={{ bottom: "calc(72px + env(safe-area-inset-bottom))" }}
        >
          <span className="text-2xl leading-none">＋</span>
          <span>新日誌</span>
        </Link>
      )}
    </div>
  );
}

function groupByCase(list: LogRow[]): CaseGroup[] {
  const map = new Map<string, CaseGroup>();
  for (const log of list) {
    const key = log.case_id ?? "_unknown";
    let g = map.get(key);
    if (!g) {
      g = {
        caseId: key,
        caseName: log.cases?.name ?? "(已刪除案件)",
        caseCode: log.cases?.code ?? null,
        logs: [],
        latestDate: log.log_date,
        counts: { draft: 0, submitted: 0, approved: 0, rejected: 0 },
      };
      map.set(key, g);
    }
    g.logs.push(log);
    if (log.log_date > g.latestDate) g.latestDate = log.log_date;
    g.counts[log.status] = (g.counts[log.status] ?? 0) + 1;
  }
  return [...map.values()].sort((a, b) => b.latestDate.localeCompare(a.latestDate));
}

function ChevronDown() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function Empty({ isSupervisor }: { isSupervisor: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-20 text-center">
      <div className="mb-3 text-5xl text-[#E0DCD6]">📋</div>
      <p className="mb-1.5 text-base text-foreground">
        {isSupervisor ? "你還沒建任何日誌" : "目前還沒有任何日誌"}
      </p>
      <p className="mb-6 text-sm text-muted-foreground">
        {isSupervisor
          ? "選一個案件開新日誌,填工項數量、加照片、送出給老闆核定"
          : "工地主任送出日誌後會出現在這裡"}
      </p>
      {isSupervisor && (
        <Button
          asChild
          size="lg"
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Link href="/logs/new">建第一份日誌</Link>
        </Button>
      )}
    </div>
  );
}
