import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import type { FieldReport, FieldReportStatus, UserRole } from "@/lib/types";

const STATUS: Record<FieldReportStatus, { label: string; cls: string }> = {
  pending: { label: "待整合", cls: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]" },
  merged: { label: "已併入日誌", cls: "bg-[#ECFDF5] text-[#4A7C59] border-[#A7F3D0]" },
  archived: { label: "已封存", cls: "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]" },
};

const REPORTERS: UserRole[] = ["field_assistant", "site_supervisor", "owner"];

type ReportRow = FieldReport & {
  cases: { name: string; code: string | null } | null;
  author: { full_name: string | null } | null;
};

type CaseGroup = {
  caseId: string;
  caseName: string;
  caseCode: string | null;
  reports: ReportRow[];
  latest: string;
  counts: Record<FieldReportStatus, number>;
};

export default async function FieldReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();

  // office_staff 看不到此頁(他們也不會被導到這)
  if (profile?.role === "office_staff") redirect("/");

  const isFieldAssistant = profile?.role === "field_assistant";
  const canCreate = !!profile && REPORTERS.includes(profile.role as UserRole);

  let query = supabase
    .from("field_reports")
    .select("*, cases(name, code), author:profiles!author_id(full_name)")
    .order("created_at", { ascending: false });

  // field_assistant 只看自己的
  if (isFieldAssistant) {
    query = query.eq("author_id", user.id);
  }

  const { data, error } = await query;
  const list = ((data ?? []) as ReportRow[]) ?? [];
  const groups = groupByCase(list);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary md:text-3xl">
            {isFieldAssistant ? "我的現場回報" : "現場回報"}
          </h1>
          <p className="mt-1.5 text-base text-muted-foreground">
            {isFieldAssistant
              ? "拍照、寫一句話,送出讓主任整合進日誌"
              : "現場拍照與文字紀錄,工地主任填日誌時可以勾選整合"}
          </p>
        </div>
        {canCreate && (
          <Button
            asChild
            size="lg"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Link href="/field-reports/new">+ 新增回報</Link>
          </Button>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          載入失敗:{error.message}
        </p>
      )}

      {!list.length ? (
        <Empty isFieldAssistant={isFieldAssistant} canCreate={canCreate} />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <details
              key={g.caseId}
              open={g.counts.pending > 0}
              className="group rounded-lg border border-[#E0DCD6] bg-card transition-colors hover:border-accent open:border-[#D4CFC8]"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-5 md:p-6 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{g.caseCode ?? "未編號"}</span>
                    <span>·</span>
                    <span>共 {g.reports.length} 筆</span>
                    <span>·</span>
                    <span>最後一筆 {new Date(g.latest).toLocaleDateString("zh-TW")}</span>
                  </div>
                  <h3 className="truncate text-lg font-semibold text-primary md:text-xl">
                    {g.caseName}
                  </h3>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {(["pending", "merged", "archived"] as FieldReportStatus[])
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
                <span className="mt-1 shrink-0 text-muted-foreground transition-transform group-open:rotate-180">
                  <ChevronDown />
                </span>
              </summary>
              <ul className="border-t border-[#E0DCD6]">
                {g.reports.map((r, idx) => {
                  const s = STATUS[r.status];
                  const photoCount = r.photos?.length ?? 0;
                  const noteSnippet = r.note?.slice(0, 80) ?? "";
                  return (
                    <li key={r.id}>
                      <Link
                        href={`/field-reports/${r.id}`}
                        className={`flex items-start justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-[#F5F1EC] md:px-6 ${
                          idx > 0 ? "border-t border-[#F0EBE4]" : ""
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-foreground">
                            <span className="font-medium">
                              {new Date(r.created_at).toLocaleString("zh-TW", {
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            {!isFieldAssistant && r.author?.full_name && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                · {r.author.full_name}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            {photoCount > 0 && <span>{photoCount} 張照片</span>}
                            {noteSnippet && (
                              <span className="line-clamp-1 max-w-[28rem]">📝 {noteSnippet}</span>
                            )}
                            {!noteSnippet && photoCount === 0 && (
                              <span>(空白)</span>
                            )}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${s.cls}`}
                        >
                          {s.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function groupByCase(list: ReportRow[]): CaseGroup[] {
  const map = new Map<string, CaseGroup>();
  for (const r of list) {
    const key = r.case_id ?? "_unknown";
    let g = map.get(key);
    if (!g) {
      g = {
        caseId: key,
        caseName: r.cases?.name ?? "(已刪除案件)",
        caseCode: r.cases?.code ?? null,
        reports: [],
        latest: r.created_at,
        counts: { pending: 0, merged: 0, archived: 0 },
      };
      map.set(key, g);
    }
    g.reports.push(r);
    if (r.created_at > g.latest) g.latest = r.created_at;
    g.counts[r.status] = (g.counts[r.status] ?? 0) + 1;
  }
  return [...map.values()].sort((a, b) => b.latest.localeCompare(a.latest));
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

function Empty({
  isFieldAssistant,
  canCreate,
}: {
  isFieldAssistant: boolean;
  canCreate: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-20 text-center">
      <div className="mb-3 text-5xl text-[#E0DCD6]">📷</div>
      <p className="mb-1.5 text-base text-foreground">
        {isFieldAssistant ? "你還沒上傳任何回報" : "還沒有現場回報"}
      </p>
      <p className="mb-6 text-sm text-muted-foreground">
        {isFieldAssistant
          ? "選一個案場,寫幾個字、加幾張照片就好"
          : "現場人員拍照寫紀錄後會出現在這裡"}
      </p>
      {canCreate && (
        <Button
          asChild
          size="lg"
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Link href="/field-reports/new">建第一筆回報</Link>
        </Button>
      )}
    </div>
  );
}
