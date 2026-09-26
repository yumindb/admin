/**
 * 員工薪制(employee_pay_profiles,migration-2.40)。
 *
 * append-only:調薪 = 新增一列;某一天生效的薪制 = effective_from <= 那天 之中
 * effective_from 最晚的一列(同一天有兩列時取 created_at 最新 — 那是「打錯重填」)。
 */

export type EmploymentType = "monthly" | "daily";

export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  monthly: "正職月薪",
  daily: "日薪",
};

/** 金額欄位的單位說明(表單 label / 列表用) */
export const AMOUNT_UNIT_LABEL: Record<EmploymentType, string> = {
  monthly: "元／月",
  daily: "元／日",
};

export type PayProfile = {
  id: string;
  user_id: string;
  employment_type: EmploymentType;
  amount: number;
  /** YYYY-MM-DD */
  effective_from: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export function isEmploymentType(v: unknown): v is EmploymentType {
  return v === "monthly" || v === "daily";
}

/**
 * 某一天(YYYY-MM-DD)生效的薪制。rows 順序不拘。
 * 沒有任何一列在那天(含)之前生效 → null(代表「還沒設定」或「未來才生效」)。
 */
export function payProfileOn(
  rows: readonly PayProfile[],
  onDate: string,
): PayProfile | null {
  let best: PayProfile | null = null;
  for (const r of rows) {
    if (r.effective_from > onDate) continue;
    if (
      !best ||
      r.effective_from > best.effective_from ||
      (r.effective_from === best.effective_from && r.created_at > best.created_at)
    ) {
      best = r;
    }
  }
  return best;
}

/** 依生效日新到舊排(同日 created_at 新到舊)— 歷史列表用 */
export function sortPayProfilesDesc(rows: readonly PayProfile[]): PayProfile[] {
  return [...rows].sort((a, b) => {
    if (a.effective_from !== b.effective_from) {
      return a.effective_from < b.effective_from ? 1 : -1;
    }
    return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
  });
}

/** 12,345 這種千分位;不帶幣別 */
export function formatNTD(n: number): string {
  return Math.round(n).toLocaleString("zh-TW");
}

/** 「正職月薪 45,000 元／月」一句話 */
export function describePayProfile(p: PayProfile): string {
  return `${EMPLOYMENT_TYPE_LABEL[p.employment_type]} ${formatNTD(p.amount)} ${AMOUNT_UNIT_LABEL[p.employment_type]}`;
}
