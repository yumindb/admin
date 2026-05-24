import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronDown, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatTW } from "@/lib/datetime";
import { getSignedUrls } from "@/lib/supabase/storage";
import { NextStepHint } from "@/components/next-step-hint";
import type { FieldReport, FieldReportStatus, UserRole } from "@/lib/types";

const STATUS: Record<FieldReportStatus, { label: string; cls: string }> = {
  pending: { label: "待整合", cls: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]" },
  merged: { label: "已併入日誌", cls: "bg-[#ECFDF5] text-[#4A7C59] border-[#A7F3D0]" },
  archived: { label: "已封存", cls: "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]" },
};

const REPORTERS: UserRole[] = ["field_assistant", "site_supervisor", "owner"];

// 日期範圍 quick filter — 配 logs 頁同一套邏輯
const RANGE_OPTIONS = [
  { key: "30", label: "近 30 天", days: 30 },
  { key: "90", label: "近 3 個月", days: 90 },
  { key: "180", label: "近半年", days: 180 },
  { key: "all", label: "全部", days: null },
] as const;
type RangeKey = (typeof RANGE_OPTIONS)[number]["key"];
const DEFAULT_RANGE: RangeKey = "90";
const ALL_HARD_LIMIT = 500;

function rangeFromParam(raw: string | undefined): RangeKey {
  const found = RANGE_OPTIONS.find((o) => o.key === raw);
  return found ? found.key : DEFAULT_RANGE;
}

function dateBoundaryISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

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
        caseName: r.cases?.name ?? "（已刪除案件）",
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

export default async function FieldReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; case_q?: string }>;
}) {
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

  // 2026-05-08:office_staff 從清單退出 redirect 拿掉,辦公室助理要定期處理回報
  // (下載照片、封存、刪除)。原 redirect 是早期 POC 的偷懶設定,已不符實際流程。
  const isFieldAssistant = profile?.role === "field_assistant";
  const canCreate = !!profile && REPORTERS.includes(profile.role as UserRole);

  const sp = await searchParams;
  const rangeKey: RangeKey = rangeFromParam(sp.range);
  const rangeOpt = RANGE_OPTIONS.find((o) => o.key === rangeKey)!;
  const caseQ = (sp.case_q ?? "").trim();
  const isSearching = caseQ.length > 0;

  // 有 case_q 時:先查符合的 cases.id,再用 .in() 過濾 field_reports
  let matchedCaseIds: string[] | null = null;
  if (isSearching) {
    const safe = caseQ.replace(/[%_\\]/g, (m) => "\\" + m);
    const pattern = `%${safe}%`;
    const { data: matched } = await supabase
      .from("cases")
      .select("id")
      .or(`name.ilike.${pattern},code.ilike.${pattern}`)
      .limit(200);
    matchedCaseIds = (matched ?? []).map((c) => c.id as string);
  }

  let query = supabase
    .from("field_reports")
    .select("*, cases(name, code), author:profiles!author_id(full_name)")
    .order("created_at", { ascending: false });

  if (isFieldAssistant) {
    query = query.eq("author_id", user.id);
  }
  if (matchedCaseIds) {
    if (matchedCaseIds.length === 0) {
      // 沒符合的 case → 強制空結果
      query = query.eq("id", "00000000-0000-0000-0000-000000000000");
    } else {
      query = query.in("case_id", matchedCaseIds);
    }
  } else if (rangeOpt.days !== null) {
    // 有 case 搜尋時不套 date filter(讓使用者看到該案完整歷史)
    query = query.gte("created_at", dateBoundaryISO(rangeOpt.days));
  } else {
    query = query.limit(ALL_HARD_LIMIT);
  }

  const { data, error } = await query;
  const list = ((data ?? []) as ReportRow[]) ?? [];
  const totalPendingCount = list.filter((r) => r.status === "pending").length;
  const hitAllLimit = rangeOpt.days === null && list.length >= ALL_HARD_LIMIT;

  // 額外查「期間外仍有 pending」— 不限日期算個數,提醒使用者擴大範圍
  let outsidePendingCount = 0;
  if (!isFieldAssistant && rangeOpt.days !== null) {
    const { count } = await supabase
      .from("field_reports")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .lt("created_at", dateBoundaryISO(rangeOpt.days));
    outsidePendingCount = count ?? 0;
  }

  function rangeHref(next: RangeKey): string {
    const params = new URLSearchParams();
    if (next !== DEFAULT_RANGE) params.set("range", next);
    if (caseQ) params.set("case_q", caseQ);
    const qs = params.toString();
    return qs ? `/field-reports?${qs}` : "/field-reports";
  }

  // Storage 已轉 private — 把每筆回報「第一張」縮圖換成 signed URL(5 min)
  const firstPhotoPaths: string[] = [];
  for (const r of list) {
    const fp = r.photos?.[0]?.path;
    if (fp) firstPhotoPaths.push(fp);
  }
  const firstPhotoSigned = await getSignedUrls(
    "daily-photos",
    firstPhotoPaths
  );

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary md:text-3xl">
            {isFieldAssistant ? "我的回報" : "現場回報"}
          </h1>
          <p className="mt-1.5 text-base text-muted-foreground">
            {isFieldAssistant
              ? "下面是您拍過、寫過的紀錄。要新增請按下方「新增回報」。"
              : "現場拍照與文字紀錄，您也可以自己加。工地主任填日誌時可勾選整合。"}
          </p>
        </div>
        {/* 桌機版：右上角藥丸形按鈕 — 跟手機 FAB 同配色，只是不浮空 */}
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

      {/* 案件搜尋(辦公室助理 / 老闆 / 主任視角才有用 — 現場人員一般只看自己) */}
      {!isFieldAssistant && (
        <form
          method="get"
          action="/field-reports"
          className="mb-3 flex flex-wrap items-center gap-2"
        >
          <input
            type="search"
            name="case_q"
            defaultValue={caseQ}
            placeholder="按案件名稱 / 案號搜尋"
            className="h-10 min-w-0 flex-1 rounded-md border border-[#E0DCD6] bg-white px-3 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
          <button
            type="submit"
            className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            搜尋
          </button>
          {isSearching && (
            <Link
              href="/field-reports"
              className="h-10 inline-flex items-center rounded-md border border-[#E0DCD6] px-3 text-sm text-muted-foreground hover:border-accent"
            >
              清除
            </Link>
          )}
        </form>
      )}

      {/* 日期範圍 quick pills(case 搜尋時隱藏 — 看該案完整歷史較有用) */}
      {!isSearching && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">期間：</span>
          {RANGE_OPTIONS.map((opt) => {
            const active = opt.key === rangeKey;
            return (
              <Link
                key={opt.key}
                href={rangeHref(opt.key)}
                className={`inline-flex items-center rounded-full border px-2.5 py-1 transition-colors ${
                  active
                    ? "border-accent bg-[#F5F1EC] font-medium text-primary"
                    : "border-[#E0DCD6] bg-white text-foreground hover:border-accent"
                }`}
              >
                {opt.label}
              </Link>
            );
          })}
        </div>
      )}

      {isSearching && (
        <div className="mb-4 rounded-md border border-[#E0DCD6] bg-[#FAF7F2] px-3 py-2 text-sm">
          <span className="text-muted-foreground">案件搜尋「</span>
          <span className="font-medium text-foreground">{caseQ}</span>
          <span className="text-muted-foreground">
            」找到 {list.length} 筆回報(顯示完整歷史)
          </span>
        </div>
      )}

      {hitAllLimit && (
        <p className="mb-4 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-sm text-[#92400E]">
          回報很多,目前只顯示最新 {ALL_HARD_LIMIT} 筆。建議縮短期間查看。
        </p>
      )}

      {outsidePendingCount > 0 && (
        <p className="mb-4 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-sm text-[#92400E]">
          期間外還有 <strong>{outsidePendingCount}</strong> 筆「待整合」回報未顯示 ——
          <Link href="/field-reports?range=all" className="ml-1 underline">看全部</Link>
        </p>
      )}

      {!isFieldAssistant && totalPendingCount > 0 && (
        <div className="mb-4">
          <NextStepHint tone="info">
            有 {totalPendingCount} 筆待整合 — 工地主任填日誌時可勾選併入。
          </NextStepHint>
        </div>
      )}

      {!list.length ? (
        <Empty isFieldAssistant={isFieldAssistant} canCreate={canCreate} />
      ) : isFieldAssistant ? (
        // 現場人員只看自己的,通常案場單一,不分組
        <ul className="space-y-4">
          {list.map((r) => (
            <li key={r.id}>
              <ReportCard
                report={r}
                showAuthor={false}
                firstPhotoSigned={firstPhotoSigned}
              />
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
                <summary className="sticky top-0 z-10 -mx-4 cursor-pointer list-none border-b-2 border-[#A07850]/30 bg-background/95 px-4 py-3 backdrop-blur transition-colors hover:bg-[#FAF7F2] md:-mx-8 md:px-8 [&::-webkit-details-marker]:hidden">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 break-words text-base font-bold leading-snug text-primary md:text-lg">
                      📍 {g.caseName}
                    </span>
                    <ChevronDown className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform duration-150 group-open/case:rotate-180" />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{g.reports.length} 筆</span>
                    {pendingCount > 0 && (
                      <span className="rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-1.5 py-0.5 font-medium text-[#D97706]">
                        {pendingCount} 待整合
                      </span>
                    )}
                  </div>
                </summary>
                <ul className="mt-3 space-y-4">
                  {g.reports.map((r) => (
                    <li key={r.id}>
                      <ReportCard
                        report={r}
                        showAuthor
                        hideCaseName
                        firstPhotoSigned={firstPhotoSigned}
                      />
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      )}

      {/* 手機 FAB(extended)：浮在右下，坐在底部 tab bar 上方。圖標 + 文字
          並排，讓使用者一眼看出來這顆鈕是做什麼的。field_assistant 已有
          底部 tab「新增回報」，不重複顯示。 */}
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
  firstPhotoSigned,
}: {
  report: ReportRow;
  showAuthor: boolean;
  /** 分組視圖中,案場名已在 sticky header 顯示,卡片內不重複 */
  hideCaseName?: boolean;
  firstPhotoSigned: Map<string, string>;
}) {
  const s = STATUS[r.status];
  const photoCount = r.photos?.length ?? 0;
  const firstPhotoOriginal = r.photos?.[0]?.path ?? null;
  const firstPhoto = firstPhotoOriginal
    ? firstPhotoSigned.get(firstPhotoOriginal) ?? firstPhotoOriginal
    : null;
  const note = r.note?.trim() ?? "";
  const ts = formatTW(r.created_at, {
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
            <div className="break-words text-lg font-semibold leading-snug text-primary">
              {r.cases?.name ?? "（已刪除案件）"}
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
          （空白）
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
        {isFieldAssistant ? "您還沒有任何回報" : "還沒有現場回報"}
      </p>
      <p className="text-base text-muted-foreground">
        {isFieldAssistant && canCreate
          ? "按下方「新增回報」開始"
          : "現場人員拍照寫紀錄後會出現在這裡"}
      </p>
    </div>
  );
}
