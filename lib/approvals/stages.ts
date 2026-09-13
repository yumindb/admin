import type { ApprovalStage, UserRole } from "@/lib/types";

/**
 * 角色 ↔ 簽核關卡的唯一對照表(2026-09-09 起集中在這裡,以前散在五個檔各抄一份)。
 *
 * 流程:fill(主任送出時簽)→ audit(辦公室助理審核)→ approve(核定人)→ approved + PDF
 *
 * - 審閱人(reviewer)**沒有關卡**:他的「加簽」跟流程無關(辦公室審核通過後隨時可簽,
 *   不擋核定、不進 PDF),寫的是 stage='review' 的紀錄 — 見 review-stage.ts。
 *   `review` 這個值 2026-09 前是「主任複核」,從沒在 production 用過。
 * - 主任也沒有自己的關卡(fill 的簽名寫在 saveLogAction)。
 */
export const STAGE_FOR_ROLE: Record<UserRole, ApprovalStage | null> = {
  site_supervisor: null,
  office_staff: "audit",
  reviewer: null,
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
  review: "審閱（審閱人加簽）",
  audit: "審核（辦公室助理）",
  approve: "核定（核定人）",
};

/** 各關「通過」的動詞 */
export const STAGE_VERB: Record<ApprovalStage, string> = {
  fill: "送出",
  review: "加簽",
  audit: "審核通過",
  approve: "核定通過",
};
