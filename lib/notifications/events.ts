import { createServiceClient } from "@/lib/supabase/server";
import { noticeFlex } from "@/lib/line/flex";
import { sendNotification } from "@/lib/notifications/notify";
import {
  createAppMessages,
  truncateBody,
} from "@/lib/notifications/messages";
import { LEAVE_TYPE_LABEL } from "@/lib/leave";
import type { ApprovalStage, LeaveType, UserRole } from "@/lib/types";

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
 *
 * 待辦類通知的按鈕一律深連到那一份(`/approvals/{logId}`),不連清單:
 * LINE 送出的訊息無法事後修改,舊卡片會一直寫著「待核定」。深連讓簽過的人
 * 點下去自動被 approvals/[id] 轉到 /logs/[id] 看到已核定,不會白點一趟
 * (2026-08 Phil 反映舊卡片分不出簽過沒)。
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
      buttonPath: `/approvals/${logId}`,
    }),
  });
}

/**
 * 被退回的日誌修正後重新送出 → 通知辦公室助理重新審核。
 *
 * 跟首次送出分開一個 event_type:訊息要講清楚這是「改好的退件」而不是新日誌,
 * 去重視窗也才不會跟前一則「新日誌待審核」互相蓋掉。
 */
export async function notifyLogResubmitted(logId: string): Promise<void> {
  const ctx = await loadLogContext(logId);
  if (!ctx) return;
  await sendNotification({
    eventType: "log_resubmitted",
    relatedId: logId,
    recipients: { roles: ["office_staff"] },
    altText: "退回的日誌已修正",
    message: noticeFlex({
      title: "退回的日誌已修正",
      lines: [
        `案件:${ctx.caseName}`,
        `日期:${fmtDate(ctx.logDate)}`,
        `主任:${ctx.supervisorName}`,
      ],
      tone: "amber",
      buttonLabel: "去重新審核",
      buttonPath: `/approvals/${logId}`,
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
      buttonPath: `/approvals/${logId}`,
    }),
  });
}

/**
 * 核定關第一位核定人簽完 → 通知「另一位」核定人補簽(雙簽制,2026-07)。
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
        `${firstSignerName ?? "另一位核定人"}已簽,還差你這一簽`,
      ],
      tone: "amber",
      buttonLabel: "去核定",
      buttonPath: `/approvals/${logId}`,
    }),
  });
}

/** 批簽的雙簽版:一位核定人批簽 N 份後,通知另一位補簽(只送一則,省額度) */
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
        "另一位核定人已經簽過了",
        "兩位都簽完才會完成核定並產出 PDF",
      ],
      tone: "amber",
      buttonLabel: "去核定",
      buttonPath: "/approvals",
    }),
  });
}

/**
 * 老闆核定通過 → 通知該份日誌的主任。
 * 核定人有留意見時把意見一起帶進卡片(2026-08:意見以前只留在系統裡沒人看到)。
 */
export async function notifyLogApproved(
  logId: string,
  comment?: string | null,
): Promise<void> {
  const ctx = await loadLogContext(logId);
  if (!ctx) return;
  const note = comment?.trim();
  await sendNotification({
    eventType: "log_approved",
    relatedId: logId,
    recipients: { profileIds: [ctx.supervisorId] },
    altText: note ? "日誌已核定(有意見)" : "日誌已核定",
    message: noticeFlex({
      title: note ? "日誌已核定,核定人有意見" : "日誌已核定",
      lines: [
        `案件:${ctx.caseName}`,
        `日期:${fmtDate(ctx.logDate)}`,
        ...(note ? [`意見:${truncate(note, 60)}`] : []),
      ],
      tone: note ? "amber" : "green",
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
// 站內消息(app_messages)— 不走 LINE,不需綁定,登入就看得到
// ============================================================
//
// 2026-08-04 業主回報:「日誌我核過的,但是我有在下面給意見,可是底下的人
// 他們那裡不會跳通知出來。」上面那些 notify* 全部只送給綁了 LINE 的人,
// 而底下的人沒綁也不打算綁 — 所以簽核意見另外走站內消息這條路。
//
// 業主拍板的投遞規則:「有意見,再有消息就好」— 通過但沒留意見不發消息。

const STAGE_ACTION_LABEL: Record<ApprovalStage, string> = {
  fill: "填表",
  review: "複核",
  audit: "審核",
  approve: "核定",
};

/** 日誌消息連到簽核歷程那一段(意見的正本在那裡) */
function logTrailLink(logId: string): string {
  return `/logs/${logId}#approval-trail`;
}

/**
 * 一份日誌的「相關人」— 主任 + 這份日誌前面關卡經手過的簽核人。
 *
 * 為什麼不是只有主任:老闆在核定關留的意見,前面審過的助理也該知道
 * (業主說的「底下的人」不只主任)。經手人從 log_approvals 撈,
 * 不分輪次 — 一份日誌經手的人最多三四個,不值得為此加條件。
 */
async function loadLogStakeholders(
  logId: string,
  supervisorId: string,
): Promise<string[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("log_approvals")
    .select("approver_id")
    .eq("log_id", logId);
  const ids = new Set<string>([supervisorId]);
  for (const row of (data ?? []) as { approver_id: string | null }[]) {
    if (row.approver_id) ids.add(row.approver_id);
  }
  return Array.from(ids);
}

async function loadActorName(actorId: string | null): Promise<string> {
  if (!actorId) return "簽核人";
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", actorId)
    .maybeSingle();
  return (data?.full_name as string | null) ?? "簽核人";
}

/**
 * 簽核通過**但有留意見** → 發站內消息給主任與前面關卡的經手人。
 * 沒留意見不呼叫這支(呼叫了也會因為 body 空而直接 return)。
 */
export async function messageLogComment(
  logId: string,
  stage: ApprovalStage,
  comment: string,
  actorId: string,
): Promise<void> {
  const body = truncateBody(comment);
  if (!body) return;
  const ctx = await loadLogContext(logId);
  if (!ctx) return;
  const [stakeholders, actorName] = await Promise.all([
    loadLogStakeholders(logId, ctx.supervisorId),
    loadActorName(actorId),
  ]);
  await createAppMessages({
    eventType: "log_comment",
    profileIds: stakeholders,
    actorId,
    relatedId: logId,
    title: `${ctx.caseName} ${fmtDate(ctx.logDate)}｜${STAGE_ACTION_LABEL[stage]}通過，有意見`,
    body: `${actorName}：${body}`,
    link: logTrailLink(logId),
  });
}

/** 退回(含強制退回)→ 站內消息(退回一定有原因,所以一律發) */
export async function messageLogRejected(
  logId: string,
  comment: string,
  actorId: string,
  opts?: { forced?: boolean },
): Promise<void> {
  const ctx = await loadLogContext(logId);
  if (!ctx) return;
  const [stakeholders, actorName] = await Promise.all([
    loadLogStakeholders(logId, ctx.supervisorId),
    loadActorName(actorId),
  ]);
  await createAppMessages({
    eventType: "log_rejected",
    profileIds: stakeholders,
    actorId,
    relatedId: logId,
    title: `${ctx.caseName} ${fmtDate(ctx.logDate)}｜日誌被${opts?.forced ? "強制" : ""}退回`,
    body: `${actorName}：${truncateBody(comment) ?? "（沒有填寫原因）"}`,
    link: logTrailLink(logId),
  });
}

/**
 * 送出後被修改 → 站內消息(2026-08-04 業主追加:「改了日誌也做通知」)。
 *
 * 誰該知道:
 *   - 日誌的主任 — 他填的東西被改了,不能只在畫面上掛個「經助理修改」標籤等他自己發現
 *   - 前面關卡經手過的人 — 他們簽的是舊版本
 *   - 重送(退回改完)時再加上**全部辦公室助理** — 這份會回到他們的待審核清單,
 *     跟 notifyLogResubmitted 的 LINE 收件人一致(但這條不需要綁 LINE)
 *
 * 內容只講「改了哪些欄位」,前後對照在日誌頁的編輯軌跡(連結帶 #edit-trail)。
 */
export async function messageLogEdited(
  logId: string,
  editorId: string,
  /** 改了哪些欄位;`null` = 這條路徑算不出差異(主任的 classic 重送) */
  changedLabels: string[] | null,
  opts?: { resubmitted?: boolean },
): Promise<void> {
  const ctx = await loadLogContext(logId);
  if (!ctx) return;
  const [stakeholders, editorName] = await Promise.all([
    loadLogStakeholders(logId, ctx.supervisorId),
    loadActorName(editorId),
  ]);
  const changedText =
    changedLabels === null
      ? "已修正並重新送出"
      : changedLabels.length > 0
        ? `改了：${changedLabels.join("、")}`
        : "內容沒有變動，直接重送";
  await createAppMessages({
    eventType: "log_edited",
    profileIds: stakeholders,
    // 重送 → 全部助理都要知道(這份會回到他們的待審核清單)
    roles: opts?.resubmitted ? ["office_staff"] : undefined,
    actorId: editorId,
    relatedId: logId,
    title: opts?.resubmitted
      ? `${ctx.caseName} ${fmtDate(ctx.logDate)}｜退回的日誌已修正並重新送出`
      : `${ctx.caseName} ${fmtDate(ctx.logDate)}｜日誌被修改`,
    body: `${editorName}：${changedText}`,
    link: `/logs/${logId}#edit-trail`,
  });
}

/** 撤回核定 → 站內消息(已核定的日誌被拉回來改,經手的人都該知道) */
export async function messageLogRevoked(
  logId: string,
  reason: string,
  actorId: string,
): Promise<void> {
  const ctx = await loadLogContext(logId);
  if (!ctx) return;
  const [stakeholders, actorName] = await Promise.all([
    loadLogStakeholders(logId, ctx.supervisorId),
    loadActorName(actorId),
  ]);
  await createAppMessages({
    eventType: "log_revoked",
    profileIds: stakeholders,
    actorId,
    relatedId: logId,
    title: `${ctx.caseName} ${fmtDate(ctx.logDate)}｜核定被撤回，回到審核關`,
    body: `${actorName}：${truncateBody(reason) ?? "（沒有填寫原因）"}`,
    link: logTrailLink(logId),
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
