import { createServiceClient } from "@/lib/supabase/server";
import { noticeFlex } from "@/lib/line/flex";
import { sendNotification } from "@/lib/notifications/notify";
import { LEAVE_TYPE_LABEL } from "@/lib/leave";
import type { LeaveType, UserRole } from "@/lib/types";

/**
 * 各業務事件 → LINE 通知。由 server actions 在狀態變更成功後,
 * 用 `after(async () => { ... })` 呼叫(不阻塞 response;失敗只 log)。
 *
 * 收件規則(對應三關簽核 fill → audit → approve):
 *   日誌送出 / 重送     → office_staff(進 audit 關)
 *   audit 過關          → owner(進 approve 關)
 *   核定通過            → 該份日誌的主任
 *   退回(含強制退回)  → 該份日誌的主任
 *   請假送出 / 推進     → 下一關角色;核准 / 退回 → 申請人
 *   現場回報            → office_staff(排除回報人自己)
 *
 * 額度提醒:官方帳號免費方案每月只有 200 則推播。批簽走彙總通知
 * (notifyLogsBatch*)避免一次批 20 份就吃掉 20 則。
 */

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** timestamptz → 台北時間 M/D HH:mm */
function fmtTaipei(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

function truncate(text: string | null, max: number): string {
  if (!text) return "";
  const t = text.trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

async function loadLogContext(logId: string) {
  const supabase = createServiceClient();
  const { data: log } = await supabase
    .from("daily_logs")
    .select("id, log_date, supervisor_id, case_id")
    .eq("id", logId)
    .maybeSingle();
  if (!log) return null;
  const [{ data: caseRow }, { data: supervisor }] = await Promise.all([
    supabase.from("cases").select("name").eq("id", log.case_id).maybeSingle(),
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", log.supervisor_id)
      .maybeSingle(),
  ]);
  return {
    logDate: log.log_date as string | null,
    supervisorId: log.supervisor_id as string,
    caseName: (caseRow?.name as string | undefined) ?? "未知案件",
    supervisorName: (supervisor?.full_name as string | undefined) ?? "主任",
  };
}

// ============================================================
// 日誌簽核
// ============================================================

/** 主任送出(或重送)日誌 → 通知辦公室助理審核 */
export async function notifyLogSubmitted(logId: string): Promise<void> {
  const ctx = await loadLogContext(logId);
  if (!ctx) return;
  await sendNotification({
    eventType: "log_submitted",
    relatedId: logId,
    recipients: { roles: ["office_staff"] },
    altText: "新日誌待審核",
    message: noticeFlex({
      title: "新日誌待審核",
      lines: [
        `案件:${ctx.caseName}`,
        `日期:${fmtDate(ctx.logDate)}`,
        `主任:${ctx.supervisorName}`,
      ],
      tone: "amber",
      buttonLabel: "去審核",
      buttonPath: "/approvals",
    }),
  });
}

/** 辦公室審核通過 → 通知老闆核定 */
export async function notifyLogAwaitingApproval(logId: string): Promise<void> {
  const ctx = await loadLogContext(logId);
  if (!ctx) return;
  await sendNotification({
    eventType: "log_to_approve",
    relatedId: logId,
    recipients: { roles: ["owner"] },
    altText: "日誌待您核定",
    message: noticeFlex({
      title: "日誌待您核定",
      lines: [
        `案件:${ctx.caseName}`,
        `日期:${fmtDate(ctx.logDate)}`,
        `主任:${ctx.supervisorName}`,
      ],
      tone: "amber",
      buttonLabel: "去核定",
      buttonPath: "/approvals",
    }),
  });
}

/**
 * 核定關第一位老闆簽完 → 通知「另一位」老闆補簽(雙簽制,2026-07)。
 * 排除剛簽完的人,免得自己收到自己的提醒。
 */
export async function notifyLogAwaitingSecondApproval(
  logId: string,
  firstSignerId: string,
  firstSignerName: string | null,
): Promise<void> {
  const ctx = await loadLogContext(logId);
  if (!ctx) return;
  await sendNotification({
    eventType: "log_to_approve",
    relatedId: logId,
    recipients: { roles: ["owner"], excludeProfileIds: [firstSignerId] },
    altText: "日誌待您第二核定",
    message: noticeFlex({
      title: "日誌等你補簽核定",
      lines: [
        `案件:${ctx.caseName}`,
        `日期:${fmtDate(ctx.logDate)}`,
        `主任:${ctx.supervisorName}`,
        `${firstSignerName ?? "另一位老闆"}已簽,還差你這一簽`,
      ],
      tone: "amber",
      buttonLabel: "去核定",
      buttonPath: "/approvals",
    }),
  });
}

/** 批簽的雙簽版:一位老闆批簽 N 份後,通知另一位老闆補簽(只送一則,省額度) */
export async function notifyLogsBatchAwaitingSecondApproval(
  count: number,
  firstSignerId: string,
): Promise<void> {
  if (count <= 0) return;
  await sendNotification({
    eventType: "log_to_approve",
    relatedId: null,
    recipients: { roles: ["owner"], excludeProfileIds: [firstSignerId] },
    altText: `${count} 份日誌等你補簽核定`,
    message: noticeFlex({
      title: `${count} 份日誌等你補簽`,
      lines: [
        "另一位老闆已經簽過了",
        "兩位都簽完才會完成核定並產出 PDF",
      ],
      tone: "amber",
      buttonLabel: "去核定",
      buttonPath: "/approvals",
    }),
  });
}

/** 老闆核定通過 → 通知該份日誌的主任 */
export async function notifyLogApproved(logId: string): Promise<void> {
  const ctx = await loadLogContext(logId);
  if (!ctx) return;
  await sendNotification({
    eventType: "log_approved",
    relatedId: logId,
    recipients: { profileIds: [ctx.supervisorId] },
    altText: "日誌已核定",
    message: noticeFlex({
      title: "日誌已核定",
      lines: [`案件:${ctx.caseName}`, `日期:${fmtDate(ctx.logDate)}`],
      tone: "green",
      buttonLabel: "查看日誌",
      buttonPath: `/logs/${logId}`,
    }),
  });
}

/** 任一關退回(含強制退回)→ 通知該份日誌的主任 */
export async function notifyLogRejected(
  logId: string,
  comment: string,
  opts?: { forced?: boolean },
): Promise<void> {
  const ctx = await loadLogContext(logId);
  if (!ctx) return;
  await sendNotification({
    eventType: "log_rejected",
    relatedId: logId,
    recipients: { profileIds: [ctx.supervisorId] },
    altText: "日誌被退回",
    message: noticeFlex({
      title: opts?.forced ? "日誌被強制退回" : "日誌被退回",
      lines: [
        `案件:${ctx.caseName}`,
        `日期:${fmtDate(ctx.logDate)}`,
        `原因:${truncate(comment, 60) || "—"}`,
      ],
      tone: "red",
      buttonLabel: "去修改重送",
      buttonPath: `/logs/${logId}`,
    }),
  });
}

// ============================================================
// 批簽彙總(省額度:一批只送一則,不逐份推播)
// ============================================================

/** 辦公室批次審核通過 N 份 → 通知老闆一則彙總 */
export async function notifyLogsBatchAwaitingApproval(
  count: number,
): Promise<void> {
  if (count <= 0) return;
  await sendNotification({
    eventType: "log_batch_to_approve",
    relatedId: null,
    recipients: { roles: ["owner"] },
    altText: `有 ${count} 份日誌待您核定`,
    message: noticeFlex({
      title: `有 ${count} 份日誌待您核定`,
      lines: ["辦公室已完成審核,等您簽名核定。"],
      tone: "amber",
      buttonLabel: "去核定",
      buttonPath: "/approvals",
    }),
  });
}

/** 老闆批次核定 → 依主任分組,各送一則彙總 */
export async function notifyLogsBatchApproved(logIds: string[]): Promise<void> {
  if (logIds.length === 0) return;
  const supabase = createServiceClient();
  const { data: logs } = await supabase
    .from("daily_logs")
    .select("id, supervisor_id")
    .in("id", logIds);
  if (!logs || logs.length === 0) return;

  const countBySupervisor = new Map<string, number>();
  for (const log of logs) {
    const sid = log.supervisor_id as string;
    countBySupervisor.set(sid, (countBySupervisor.get(sid) ?? 0) + 1);
  }
  for (const [supervisorId, count] of countBySupervisor) {
    await sendNotification({
      eventType: "log_batch_approved",
      relatedId: null,
      recipients: { profileIds: [supervisorId] },
      altText: `您的 ${count} 份日誌已核定`,
      message: noticeFlex({
        title: `您的 ${count} 份日誌已核定`,
        lines: ["老闆已完成核定,PDF 產生中。"],
        tone: "green",
        buttonLabel: "查看日誌",
        buttonPath: "/logs",
      }),
    });
  }
}

// ============================================================
// 請假
// ============================================================

async function loadLeaveContext(requestId: string) {
  const supabase = createServiceClient();
  const { data: req } = await supabase
    .from("leave_requests")
    .select(
      "id, applicant_id, leave_type, start_at, end_at, total_hours, current_step",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return null;
  const { data: applicant } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", req.applicant_id)
    .maybeSingle();
  const leaveType = req.leave_type as LeaveType;
  return {
    applicantId: req.applicant_id as string,
    applicantName: (applicant?.full_name as string | undefined) ?? "同事",
    typeLabel: LEAVE_TYPE_LABEL[leaveType] ?? String(req.leave_type),
    period: `${fmtTaipei(req.start_at as string)} — ${fmtTaipei(req.end_at as string)}`,
    hours: String(req.total_hours),
    currentStep: (req.current_step as UserRole | null) ?? null,
  };
}

/** 請假送出 → 通知第一關角色 */
export async function notifyLeaveSubmitted(requestId: string): Promise<void> {
  const ctx = await loadLeaveContext(requestId);
  if (!ctx || !ctx.currentStep) return;
  await sendNotification({
    eventType: "leave_submitted",
    relatedId: requestId,
    recipients: { roles: [ctx.currentStep], excludeProfileIds: [ctx.applicantId] },
    altText: "新請假單待簽核",
    message: noticeFlex({
      title: "新請假單待簽核",
      lines: [
        `申請人:${ctx.applicantName}`,
        `假別:${ctx.typeLabel}(${ctx.hours} 小時)`,
        `期間:${ctx.period}`,
      ],
      tone: "amber",
      buttonLabel: "去簽核",
      buttonPath: "/leaves",
    }),
  });
}

/** 請假推進到下一關 → 通知該關角色 */
export async function notifyLeaveAdvanced(
  requestId: string,
  nextRole: UserRole,
): Promise<void> {
  const ctx = await loadLeaveContext(requestId);
  if (!ctx) return;
  await sendNotification({
    eventType: "leave_advanced",
    relatedId: requestId,
    recipients: { roles: [nextRole], excludeProfileIds: [ctx.applicantId] },
    altText: "請假單待您簽核",
    message: noticeFlex({
      title: "請假單待您簽核",
      lines: [
        `申請人:${ctx.applicantName}`,
        `假別:${ctx.typeLabel}(${ctx.hours} 小時)`,
        `期間:${ctx.period}`,
      ],
      tone: "amber",
      buttonLabel: "去簽核",
      buttonPath: "/leaves",
    }),
  });
}

/** 請假核准 / 退回 → 通知申請人 */
export async function notifyLeaveResolved(
  requestId: string,
  decision: "approved" | "rejected",
  comment?: string,
): Promise<void> {
  const ctx = await loadLeaveContext(requestId);
  if (!ctx) return;
  const approved = decision === "approved";
  await sendNotification({
    eventType: `leave_${decision}`,
    relatedId: requestId,
    recipients: { profileIds: [ctx.applicantId] },
    altText: approved ? "請假已核准" : "請假被退回",
    message: noticeFlex({
      title: approved ? "請假已核准" : "請假被退回",
      lines: [
        `假別:${ctx.typeLabel}(${ctx.hours} 小時)`,
        `期間:${ctx.period}`,
        ...(approved ? [] : [`原因:${truncate(comment ?? "", 60) || "—"}`]),
      ],
      tone: approved ? "green" : "red",
      buttonLabel: "查看請假",
      buttonPath: "/leaves",
    }),
  });
}

// ============================================================
// 現場回報
// ============================================================

/** 新現場回報 → 通知辦公室助理(排除回報人自己) */
export async function notifyFieldReportCreated(reportId: string): Promise<void> {
  const supabase = createServiceClient();
  const { data: report } = await supabase
    .from("field_reports")
    .select("id, case_id, author_id, note")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return;
  const [{ data: caseRow }, { data: author }] = await Promise.all([
    supabase
      .from("cases")
      .select("name")
      .eq("id", report.case_id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", report.author_id)
      .maybeSingle(),
  ]);
  await sendNotification({
    eventType: "field_report_created",
    relatedId: reportId,
    recipients: {
      roles: ["office_staff"],
      excludeProfileIds: [report.author_id as string],
    },
    altText: "新現場回報",
    message: noticeFlex({
      title: "新現場回報",
      lines: [
        `案件:${(caseRow?.name as string | undefined) ?? "未知案件"}`,
        `回報人:${(author?.full_name as string | undefined) ?? "—"}`,
        ...(report.note ? [truncate(report.note as string, 40)] : []),
      ],
      tone: "amber",
      buttonLabel: "查看回報",
      buttonPath: "/field-reports",
    }),
  });
}
