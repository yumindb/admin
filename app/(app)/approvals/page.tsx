import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatWeatherSummary } from "@/lib/daily-log";
import { NextStepHint } from "@/components/next-step-hint";
import type { ApprovalStage, DailyLog, UserRole } from "@/lib/types";

type LogRow = DailyLog & {
  cases: { name: string; code: string | null } | null;
  profiles: { full_name: string } | null;
};

const STAGE_FOR_ROLE: Record<UserRole, ApprovalStage | null> = {
  site_supervisor: "review",
  office_staff: "audit",
  owner: "approve",
};

const PAGE_COPY: Record<
  ApprovalStage,
  { title: string; subtitle: string; emptyHint: string }
> = {
  review: {
    title: "待複核",
    subtitle: "你送出的日誌等你自己複核確認",
    emptyHint: "送出新日誌後會出現在這裡。可在「我的日誌」找草稿",
  },
  audit: {
    title: "待審核",
    subtitle: "工地主任複核完的日誌等你審核文件完整性",
    emptyHint: "工地主任複核後會出現在這裡",
  },
  approve: {
    title: "待核定",
    subtitle: "辦公室助理審核通過的日誌等你最後核定",
    emptyHint: "辦公室助理審核後會出現在這裡",
  },
};

export default async function ApprovalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .maybeSingle();

  const role = (profile?.role ?? null) as UserRole | null;
  const stage = role ? STAGE_FOR_ROLE[role] : null;
  if (!stage) redirect("/logs");

  let query = supabase
    .from("daily_logs")
    .select("*, cases(name, code), profiles!daily_logs_supervisor_id_fkey(full_name)")
    .eq("status", "submitted")
    .eq("current_stage", stage)
    .order("submitted_at", { ascending: true });

  // supervisor 只看自己的日誌(複核 = 自核 / 其他主任的我們暫不分)
  if (role === "site_supervisor") {
    query = query.eq("supervisor_id", user!.id);
  }

  const { data: pending } = await query;
  const list = (pending ?? []) as LogRow[];
  const copy = PAGE_COPY[stage];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-primary md:text-3xl">
          {copy.title}
        </h1>
        <p className="mt-1.5 text-base text-muted-foreground">{copy.subtitle}</p>
      </div>

      <div className="mb-6">
        <NextStepHint tone="muted">
          四關流程:填表 → 複核(工地主任) → 審核(辦公室助理) → 核定(老闆)。
          每關退回都會回到「我的日誌」讓主任修正後重送。
        </NextStepHint>
      </div>

      {!list.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-20 text-center">
          <div className="mb-3 text-5xl text-[#E0DCD6]">✓</div>
          <p className="text-base text-foreground">沒有待處理的日誌</p>
          <p className="mt-1.5 text-sm text-muted-foreground">{copy.emptyHint}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {list.map((l) => (
            <Link
              key={l.id}
              href={`/approvals/${l.id}`}
              className="block rounded-lg border border-[#E0DCD6] bg-card p-5 transition-colors hover:border-accent md:p-6"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm text-muted-foreground">
                    {l.cases?.code ?? "未編號"}
                  </div>
                  <h3 className="text-lg font-semibold text-primary md:text-xl">
                    {l.cases?.name ?? "(已刪除案件)"}
                  </h3>
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  <div>{new Date(l.log_date).toLocaleDateString("zh-TW")}</div>
                  <div>{l.profiles?.full_name ?? "未知主任"}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
                <span>{l.work_items?.length ?? 0} 個工項</span>
                <span>{l.photos?.length ?? 0} 張照片</span>
                {l.weather && <span>{formatWeatherSummary(l.weather)}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
