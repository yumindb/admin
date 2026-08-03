import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import { getSignedUrl } from "@/lib/supabase/storage";
import { findApproveSignedLogIds } from "@/lib/approvals/dual-sign";
import { NextStepHint } from "@/components/next-step-hint";
import { BatchApprovalsList } from "./batch-actions";
import type { ApprovalStage, DailyLog, UserRole } from "@/lib/types";

type LogRow = DailyLog & {
  cases: { name: string; code: string | null } | null;
  profiles: { full_name: string } | null;
};

const STAGE_FOR_ROLE: Record<UserRole, ApprovalStage | null> = {
  site_supervisor: "review",
  office_staff: "audit",
  owner: "approve",
  field_assistant: null,
};

const PAGE_COPY: Record<
  ApprovalStage,
  { title: string; subtitle: string; emptyHint: string }
> = {
  fill: {
    title: "草稿",
    subtitle: "尚未送出的日誌",
    emptyHint: "目前沒有草稿",
  },
  review: {
    title: "待複核",
    subtitle: "您送出的日誌等您自己複核確認",
    emptyHint: "送出新日誌後會出現在這裡。可在「我的日誌」找草稿",
  },
  audit: {
    title: "待審核",
    subtitle: "工地主任複核完的日誌等您審核文件完整性",
    emptyHint: "工地主任複核後會出現在這裡",
  },
  approve: {
    title: "待核定",
    subtitle: "辦公室助理審核通過的日誌等您最後核定",
    emptyHint: "辦公室助理審核後會出現在這裡",
  },
};

export default async function ApprovalsPage() {
  const supabase = await createClient();
  // layout 已載過(cache 命中),不重打 auth server
  const actor = await tryGetActor();
  if (!actor) redirect("/login");

  const role = actor.role as UserRole;
  const stage = STAGE_FOR_ROLE[role];
  if (!stage) redirect("/logs");

  let query = supabase
    .from("daily_logs")
    .select("*, cases(name, code), profiles!daily_logs_supervisor_id_fkey(full_name)")
    .eq("status", "submitted")
    .eq("current_stage", stage)
    .order("submitted_at", { ascending: true });

  // supervisor 只看自己的日誌(複核 = 自核 / 其他主任的我們暫不分)
  if (role === "site_supervisor") {
    query = query.eq("supervisor_id", actor.id);
  }

  // 待簽清單與簽名圖章互不相干 — 一起發,不要讓 owner 多等一趟 storage 簽章。
  // 簽名圖章(owner 先試用):批簽 modal 用。6h TTL 蓋掉整段簽核時間
  const [pendingRes, stampUrl] = await Promise.all([
    query,
    role === "owner"
      ? getSignedUrl("signatures", `${actor.id}/stamp.png`, 6 * 60 * 60)
      : Promise.resolve(null),
  ]);
  let list = (pendingRes.data ?? []) as LogRow[];

  // 核定關雙簽:我已經簽過的先不顯示(等另一位核定人簽),另外算一個提示數字
  let awaitingOtherCount = 0;
  if (stage === "approve" && list.length > 0) {
    const signed = await findApproveSignedLogIds(
      supabase,
      actor.id,
      list.map((l) => ({ id: l.id, submitted_at: l.submitted_at ?? null })),
    );
    awaitingOtherCount = signed.size;
    list = list.filter((l) => !signed.has(l.id));
  }
  // 「經助理修改」— 核定前值得知道這份被辦公室動過(業主 2026-08 要求)
  const officeEditedIds: string[] = [];
  if (list.length > 0) {
    const { data: officeEdits } = await supabase
      .from("daily_log_revisions")
      .select("log_id")
      .eq("editor_role", "office_staff")
      .in(
        "log_id",
        list.map((l) => l.id),
      );
    for (const r of (officeEdits ?? []) as { log_id: string }[]) {
      if (!officeEditedIds.includes(r.log_id)) officeEditedIds.push(r.log_id);
    }
  }

  const copy = PAGE_COPY[stage];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-primary md:text-3xl">
            {copy.title}
          </h1>
          {list.length > 0 && (
            <span
              aria-label={`待簽 ${list.length} 份`}
              className="inline-flex min-w-[2.5rem] items-center justify-center rounded-full bg-[#B91C1C] px-2.5 py-0.5 text-sm font-semibold tabular-nums text-white"
            >
              待簽 {list.length}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-base text-muted-foreground">{copy.subtitle}</p>
      </div>

      <div className="mb-6">
        <NextStepHint tone="muted">
          四關流程：填表 → 複核（工地主任） → 審核（辦公室助理） → 核定（老闆）。
          每關退回都會回到「我的日誌」讓主任修正後重送。
          {stage === "approve" && "核定要兩位核定人都簽名才算完成。"}
        </NextStepHint>
      </div>

      {awaitingOtherCount > 0 && (
        <div className="mb-6 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-sm text-[#92400E]">
          另有 {awaitingOtherCount} 份你已經簽過，正在等另一位核定人補簽，簽完就會自動完成核定。
        </div>
      )}

      {!list.length ? (
        <div className="space-y-4">
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-20 text-center">
            <CheckCircle2
              className="mb-3 size-14 text-[#E0DCD6]"
              strokeWidth={1.5}
              aria-hidden
            />
            <p className="text-base text-foreground">沒有待處理的日誌</p>
            <p className="mt-1.5 text-sm text-muted-foreground">{copy.emptyHint}</p>
          </div>
          {role === "owner" && (
            <NextStepHint tone="success">
              全部簽完，辛苦了。新日誌進來會在 LINE 通知（待開通）。
            </NextStepHint>
          )}
        </div>
      ) : (
        <BatchApprovalsList
          logs={list}
          stage={stage}
          role={role!}
          stampUrl={stampUrl}
          officeEditedIds={officeEditedIds}
        />
      )}
    </div>
  );
}
