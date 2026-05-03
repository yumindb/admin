/**
 * 三家公司名稱的單一 source of truth。
 *
 * 三公司共用同一個 Supabase instance（依用戶決策不做資料隔離），
 * 只在 cases.company 欄位記錄這個案是哪家公司接的。
 *
 * 日誌、簽核、報表都跟著 case 走，不需要自己再選一次。
 *
 * 多一家公司：在 COMPANIES 加一行，重 deploy 即可。
 */

export const COMPANIES = [
  "銘毅工程企業有限公司",
  "陸毅建築開發有限公司",
  "裕民工務企業有限公司",
] as const;

export type Company = (typeof COMPANIES)[number];

/** 預設公司（開新案表單預選 + DB default 不對應時的 fallback） */
export const DEFAULT_COMPANY: Company = "裕民工務企業有限公司";

/** 短標籤：列表卡片、頁面 header、tab 等空間有限的地方用 */
export const COMPANY_SHORT: Record<Company, string> = {
  銘毅工程企業有限公司: "銘毅",
  陸毅建築開發有限公司: "陸毅",
  裕民工務企業有限公司: "裕民",
};

/** 取短標籤；若 value 不在三家正式名稱內，回原值（避免歷史資料消失） */
export function getCompanyShort(value: string | null | undefined): string {
  if (!value) return "";
  if (value in COMPANY_SHORT) return COMPANY_SHORT[value as Company];
  return value;
}

/** 驗證輸入是否為合法公司名 */
export function isValidCompany(value: unknown): value is Company {
  return typeof value === "string" && (COMPANIES as readonly string[]).includes(value);
}
