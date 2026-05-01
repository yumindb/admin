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
        {/* 桌機版:右上角 — 跟 /logs 的「+ 新日誌」一致 */}
        {canCreate && (
          <Button
            asChild
            size="lg"
            className="hidden bg-primary text-primary-foreground hover:bg-primary/90 md:inline-flex"
          >
            <Link href="/field-reports/new">+ 新增回報</Link>
          </Button>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-lg border-2 border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-base text-[#B91C1C]">
          載入失敗:{error.message}
        </p>
      )}

      {!list.length ? (
        <Empty isFieldAssistant={isFieldAssistant} canCreate={canCreate} />
      ) : (
        <ul className="space-y-4">
          {list.map((r) => (
            <li key={r.id}>
              <ReportCard report={r} showAuthor={!isFieldAssistant} />
            </li>
          ))}
        </ul>
      )}

      {/* 手機 FAB(extended):浮在右下,坐在底部 tab bar 上方。圖標 + 文字
          並排,讓使用者一眼看出來這顆鈕是做什麼的。field_assistant 已有
          底部 tab「新增回報」,不重複顯示。 */}
      {canCreate && !isFieldAssistant && (
        <Link
          href="/field-reports/new"
          aria-label="新增回報"
          className="fixed right-4 z-30 inline-flex h-16 items-center gap-2 rounded-full bg-[#A07850] px-6 text-lg font-bold text-white shadow-xl ring-2 ring-white transition-transform active:scale-95 md:hidden"
          style={{ bottom: "calc(84px + env(safe-area-inset-bottom))" }}
        >
          <span className="text-3xl leading-none">＋</span>
          <span>新回報</span>
        </Link>
      )}
    </div>
  );
}

function ReportCard({
  report: r,
  showAuthor,
}: {
  report: ReportRow;
  showAuthor: boolean;
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
          <div className="truncate text-lg font-semibold text-primary">
            {r.cases?.name ?? "(已刪除案件)"}
          </div>
          <div className="mt-0.5 text-sm text-muted-foreground">
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
