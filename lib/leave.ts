import type {
  LeaveRequest,
  LeaveStatus,
  LeaveType,
  UserRole,
} from "@/lib/types";

/**
 * 角色階層(由低到高)。簽核鏈 = 申請人之上所有角色,依序往上送。
 * field_assistant 是基層;owner 是最高,owner 本人不能送請假(沒人能簽)。
 */
const ROLE_HIERARCHY: UserRole[] = [
  "field_assistant",
  "site_supervisor",
  "office_staff",
  "owner",
];

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  personal: "事假",
  sick: "病假",
  official: "公假",
  annual: "特休",
  menstrual: "生理假",
  bereavement: "喪假",
  marriage: "婚假",
  other: "其他",
};

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: "簽核中",
  approved: "已核准",
  rejected: "已退回",
  cancelled: "已取消",
};

export const LEAVE_STATUS_CLS: Record<LeaveStatus, string> = {
  pending: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]",
  approved: "bg-[#ECFDF5] text-[#4A7C59] border-[#A7F3D0]",
  rejected: "bg-[#FEF2F2] text-[#B91C1C] border-[#FCA5A5]",
  cancelled: "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]",
};

export const ROLE_LABEL: Record<UserRole, string> = {
  field_assistant: "現場人員",
  site_supervisor: "工地主任",
  office_staff: "辦公室助理",
  owner: "老闆",
};

/**
 * 申請人角色 → 簽核鏈(由低到高;不含申請人自己)。
 * owner 沒有上層,回空陣列;不能送。
 */
export function getApprovalChain(applicantRole: UserRole): UserRole[] {
  const idx = ROLE_HIERARCHY.indexOf(applicantRole);
  if (idx < 0) return [];
  return ROLE_HIERARCHY.slice(idx + 1);
}

export function canApplyLeave(role: UserRole): boolean {
  return getApprovalChain(role).length > 0;
}

/**
 * 推進到下一關(已知當前 step 與 chain)。
 * 回 null 表示已是最後一關 → 整份 approved。
 */
export function nextStep(chain: UserRole[], current: UserRole | null): UserRole | null {
  if (!current) return null;
  const idx = chain.indexOf(current);
  if (idx < 0 || idx === chain.length - 1) return null;
  return chain[idx + 1];
}

/**
 * 算兩個時間之間的時數,四捨五入到 0.5。
 * 例:08:30 → 17:30 = 9.0 小時(扣不扣午休由 server 視政策另算,POC 先不扣)
 */
export function hoursBetween(startISO: string, endISO: string): number {
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  const hours = (e - s) / (1000 * 60 * 60);
  return Math.round(hours * 2) / 2;
}

/**
 * 判斷使用者對某筆請假是否該看到簽核按鈕。
 * 條件:status='pending' + current_step === 我的 role + 我不是申請人(避免自己簽自己)
 */
export function canActOnLeave(
  req: Pick<LeaveRequest, "status" | "current_step" | "applicant_id">,
  myRole: UserRole,
  myUserId: string,
): boolean {
  if (req.status !== "pending") return false;
  if (req.applicant_id === myUserId) return false;
  return req.current_step === myRole;
}
