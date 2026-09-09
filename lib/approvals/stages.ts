import type { ApprovalStage, UserRole } from "@/lib/types";

/**
 * 角色 ↔ 簽核關卡的唯一對照表(2026-09-09 起集中在這裡,以前散在五個檔各抄一份)。
 *
 * 流程:
 *   fill(主任送出時簽)→ audit(辦公室助理審核)
 *     → review(審閱人,**可選關卡**,見 review-stage.ts)→ approve(核定人)→ approved + PDF
 *
 * - `review` 關 2026-09 前是「主任複核」,從沒在 production 用過(log_approvals 零筆);
 *   現在改給審閱人用。主任沒有自己的關卡(fill 的簽名寫在 saveLogAction)。
 * - 審閱人的簽名只留在系統(簽核歷程 / 我簽過的),**不進 PDF** — 見 lib/pdf。
 */
export const STAGE_FOR_ROLE: Record<UserRole, ApprovalStage | null> = {
  site_supervisor: null,
  office_staff: "audit",
  reviewer: "review",
  owner: "approve",
  field_assistant: null,
};

/** 關卡短名(按鈕 / 標籤用) */
export const STAGE_LABEL: Record<ApprovalStage, string> = {
  fill: "填表",
  review: "審閱",
  audit: "審核",
  approve: "核定",
};

/** 關卡 + 負責角色(歷程 / 報表用;UI 文案一律寫「核定人」不點名老闆) */
export const STAGE_ACTOR_LABEL: Record<ApprovalStage, string> = {
  fill: "填表（工地主任）",
  review: "審閱（審閱人）",
  audit: "審核（辦公室助理）",
  approve: "核定（核定人）",
};

/** 各關「通過」的動詞 */
export const STAGE_VERB: Record<ApprovalStage, string> = {
  fill: "送出",
  review: "審閱通過",
  audit: "審核通過",
  approve: "核定通過",
};
