import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTW, formatTW } from "@/lib/datetime";
import type { ApprovalDecision, ApprovalStage } from "@/lib/types";
import { HistoryFilters } from "./history-filters";

const STAGE_LABEL: Record<ApprovalStage, string> = {
  fill: "填表",
  review: "複核",
  audit: "審核",
  approve: "核定",
};

type Row = {
  id: string;
  log_id: string;
  stage: ApprovalStage;
  decision: ApprovalDecision;
  comment: string | null;
  created_at: string;
  daily_logs:
    | {
        id: string;
        log_date: string;
        cases: { name: string; code: string | null } | null;
      }
    | null;
};

export default async function ApprovalsHistoryPage() {
  // 角色守則:只有有簽核權限的角色看自己歷程。
  // field_assistant 不簽核 → 拒入。
  let actor;
  try {
    actor = await requireRole(["site_supervisor", "office_staff", "owner"]);
  } catch {
    redirect("/logs");
  }

  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("log_approvals")
    .select(
      "id, log_id, stage, decision, comment, created_at, daily_logs!inner(id, log_date, cases(name, code))"
    )
    .eq("approver_id", actor.id)
    .order("created_at", { ascending: false });

  const list = (rows ?? []) as unknown as Row[];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-7">
        <h1 className="text-2xl font-semibold text-primary md:text-3xl">
          我簽過的
        </h1>
        <p className="mt-1.5 text-base text-muted-foreground">
          您過去通過 / 退回的所有日誌簽核紀錄，共 {list.length} 筆。
        </p>
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-20 text-center">
          <div className="mb-3 text-5xl text-[#E0DCD6]">📜</div>
          <p className="text-base text-foreground">還沒有任何簽核紀錄</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            等你開始通過 / 退回日誌後就會出現在這裡
          </p>
        </div>
      ) : (
        <HistoryFilters
          rows={list.map((r) => ({
            id: r.id,
            logId: r.log_id,
            stage: r.stage,
            stageLabel: STAGE_LABEL[r.stage] ?? r.stage,
            decision: r.decision,
            comment: r.comment,
            createdAt: r.created_at,
            createdAtLabel: formatTW(r.created_at),
            logDate: r.daily_logs?.log_date ?? "",
            logDateLabel: r.daily_logs?.log_date
              ? formatDateTW(r.daily_logs.log_date)
              : "—",
            caseName: r.daily_logs?.cases?.name ?? "（已刪除案件）",
            caseCode: r.daily_logs?.cases?.code ?? null,
          }))}
        />
      )}
    </div>
  );
}
