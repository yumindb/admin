import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronDown, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
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
};

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
      };
      map.set(key, g);
    }
    g.reports.push(r);
    if (r.created_at > g.latest) g.latest = r.created_at;
  }
  return [...map.values()].sort((a, b) => b.latest.localeCompare(a.latest));
}

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

  if (profile?.role === "office_staff") redirect("/");

  const isFieldAssistant = profile?.role === "field_assistant";
  const canCreate = !!profile && REPORTERS.includes(profile.role as UserRole);

  let query = supabase
    .from("field_reports")
    .select("*, cases(name, code), author:profiles!author_id(full_name)")
    .order("created_at", { ascending: false });

  if (isFieldAssistant) {
    query = query.eq("author_id", user.id);
  }

  const { data, error } = await query;
  const list = ((data ?? []) as ReportRow[]) ?? [];

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary md:text-3xl">
            {isFieldAssistant ? "我的回報" : "現場回報"}
          </h1>
          <p className="mt-1.5 text-base text-muted-foreground">
            {isFieldAssistant
              ? "下面是你拍過、寫過的紀錄。要新增請按下方「新增回報」。"
              : "現場拍照與文字紀錄,你也可以自己加。工地主任填日誌時可勾選整合。"}
          </p>
        </div>
        {/* 桌機版:右上角藥丸形按鈕 — 跟手機 FAB 同配色,只是不浮空 */}
        {canCreate && (
          <Link
            href="/field-reports/new"
            className="hidden h-14 items-center gap-2 rounded-full border border-[#8B6845] bg-[#A07850] py-0 pl-5 pr-6 text-base font-medium tracking-wider text-white shadow-sm transition-all duration-150 hover:bg-[#8B6845] active:scale-[0.97] md:inline-flex"
          >
            <Plus className="size-5" strokeWidth={2.25} aria-hidden />
            <span>新回報</span>
          </Link>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-lg border-2 border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-base text-[#B91C1C]">
          載入失敗:{error.message}
        </p>
      )}

      {!list.length ? (
        <Empty isFieldAssistant={isFieldAssistant} canCreate={canCreate} />
      ) : isFieldAssistant ? (
        // 現場助理只看自己的,通常案場單一,不分組
        <ul className="space-y-4">
          {list.map((r) => (
            <li key={r.id}>
              <ReportCard report={r} showAuthor={false} />
            </li>
          ))}
        </ul>
      ) : (
        // 工地主任 / 老闆 / 辦公室助理:跨案場 — 依案場分組,可摺疊。
        // 預設展開「有待整合」的案場,其餘收起 — 一打開就先處理該處理的。
        <div className="space-y-3">
          {groupByCase(list).map((g) => {
            const pendingCount = g.reports.filter(
              (r) => r.status === "pending"
            ).length;
            const defaultOpen = pendingCount > 0;
            return (
              <details
                key={g.caseId}
                open={defaultOpen}
                className="group/case rounded-lg"
              >
                <summary className="sticky top-0 z-10 -mx-4 flex cursor-pointer list-none items-center gap-2 border-b-2 border-[#A07850]/30 bg-background/95 px-4 py-3 backdrop-blur transition-colors hover:bg-[#FAF7F2] md:-mx-8 md:px-8 [&::-webkit-details-marker]:hidden">
                  <span className="line-clamp-2 flex-1 text-base font-bold leading-snug text-primary md:text-lg">
                    📍 {g.caseName}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {g.reports.length} 筆
                    {pendingCount > 0 && (
                      <span className="ml-1.5 rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-1.5 py-0.5 font-medium text-[#D97706]">
                        {pendingCount} 待整合
                      </span>
                    )}
                  </span>
                  <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform duration-150 group-open/case:rotate-180" />
                </summary>
                <ul className="mt-3 space-y-4">
                  {g.reports.map((r) => (
                    <li key={r.id}>
                      <ReportCard report={r} showAuthor hideCaseName />
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      )}

      {/* 手機 FAB(extended):浮在右下,坐在底部 tab bar 上方。圖標 + 文字
          並排,讓使用者一眼看出來這顆鈕是做什麼的。field_assistant 已有
          底部 tab「新增回報」,不重複顯示。 */}
      {canCreate && !isFieldAssistant && (
        <Link
          href="/field-reports/new"
          aria-label="新增回報"
          className="fixed right-4 z-30 inline-flex h-14 items-center gap-2 rounded-full border border-[#8B6845] bg-[#A07850] py-0 pl-4 pr-5 text-base font-medium tracking-wider text-white transition-all duration-150 active:scale-[0.97] md:hidden"
          style={{
            bottom: "calc(84px + env(safe-area-inset-bottom))",
            boxShadow:
              "0 10px 24px -6px rgba(120, 84, 48, 0.45), 0 2px 6px rgba(0, 0, 0, 0.08)",
          }}
        >
          <Plus className="size-5" strokeWidth={2.25} aria-hidden />
          <span>新回報</span>
        </Link>
      )}
    </div>
  );
}

function ReportCard({
  report: r,
  showAuthor,
  hideCaseName = false,
}: {
  report: ReportRow;
  showAuthor: boolean;
  /** 分組視圖中,案場名已在 sticky header 顯示,卡片內不重複 */
  hideCaseName?: boolean;
}) {
  const s = STATUS[r.status];
  const photoCount = r.photos?.length ?? 0;
  const firstPhoto = r.photos?.[0]?.path ?? null;
  const note = r.note?.trim() ?? "";
  const ts = new Date(r.created_at).toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Link
      href={`/field-reports/${r.id}`}
      className="block overflow-hidden rounded-xl border-2 border-[#E0DCD6] bg-card transition-colors hover:border-accent active:bg-[#FAF7F2]"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          {!hideCaseName && (
            <div className="line-clamp-2 text-lg font-semibold leading-snug text-primary">
              {r.cases?.name ?? "(已刪除案件)"}
            </div>
          )}
          <div className={hideCaseName ? "text-sm text-muted-foreground" : "mt-0.5 text-sm text-muted-foreground"}>
            {ts}
            {showAuthor && r.author?.full_name && ` · ${r.author.full_name}`}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${s.cls}`}
        >
          {s.label}
        </span>
      </div>

      {/* Photo (big, contain — full image visible) */}
      {firstPhoto ? (
        <div className="relative bg-[#F5F1EC]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={firstPhoto}
            alt=""
            className="mx-auto block h-56 w-full object-contain"
          />
          {photoCount > 1 && (
            <span className="absolute right-3 top-3 rounded-full bg-black/65 px-3 py-1 text-sm font-medium text-white shadow-sm">
              📷 {photoCount}
            </span>
          )}
        </div>
      ) : null}

      {/* Note */}
      {note ? (
        <p className="line-clamp-3 whitespace-pre-line px-4 py-3 text-base text-foreground">
          {note}
        </p>
      ) : !firstPhoto ? (
        <p className="px-4 py-6 text-center text-base text-muted-foreground">
          (空白)
        </p>
      ) : null}
    </Link>
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
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#E0DCD6] bg-card px-6 py-20 text-center">
      <div className="mb-4 text-7xl">📷</div>
      <p className="mb-2 text-lg font-medium text-foreground">
        {isFieldAssistant ? "你還沒有任何回報" : "還沒有現場回報"}
      </p>
      <p className="text-base text-muted-foreground">
        {isFieldAssistant && canCreate
          ? "按下方「新增回報」開始"
          : "現場人員拍照寫紀錄後會出現在這裡"}
      </p>
    </div>
  );
}
