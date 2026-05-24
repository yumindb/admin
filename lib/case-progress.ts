/**
 * 案件進度判斷 helpers — server 與 client 共用，不可加 "use client"。
 *
 * 為什麼分到這裡：cases/page.tsx (server) 與 cases-overview-list.tsx (client)
 * 都要呼叫 isCaseBehind；client component 內 export 的函式不能在 server 直接呼叫
 * （Next 15 限制：「Attempted to call ... from the server but ... is on the client」）。
 */

import type { LogPhoto } from "@/lib/types";

export type CaseStats = {
  itemCount: number;
  logCount: number;
  progressPct: number | null;
  extraCount: number;
  unsignedCount: number;
  photos: LogPhoto[];
  photoTotal: number;
  startedDaysAgo: number | null;
};

/** 進度落後判斷：< 30% 且開工 > 60 天前 */
export function isCaseBehind(stats: CaseStats): boolean {
  if (stats.progressPct === null) return false;
  if (stats.startedDaysAgo === null) return false;
  return stats.progressPct < 30 && stats.startedDaysAgo > 60;
}

/**
 * 案場健康度紅綠燈 — Phil 視角:不要冷冰冰的進度 %，要紅綠燈一眼看出狀況。
 *
 * 規則(優先順序高到低):
 *   - 🔴 紅:進度落後(< 30% 且 開工 > 60 天) — 嚴重
 *           或合約外 ≥ 5 筆 — 已有不少 scope creep
 *   - 🟡 黃:有 1-4 筆合約外 / 未簽約
 *           或開工但近 5 天沒新日誌(近期停滯)
 *   - 🟢 綠:其他狀況(進行中、有日誌、無異常)
 *
 * lastLogDaysAgo 由呼叫端提供(可選);沒給就只看進度 + 合約外。
 */
export type CaseHealth = "green" | "amber" | "red";

export function caseHealth(
  stats: CaseStats,
  opts?: { lastLogDaysAgo?: number | null },
): CaseHealth {
  if (isCaseBehind(stats)) return "red";
  if (stats.extraCount >= 5 || stats.unsignedCount >= 5) return "red";
  if (stats.extraCount > 0 || stats.unsignedCount > 0) return "amber";
  const lastLog = opts?.lastLogDaysAgo;
  if (
    typeof lastLog === "number" &&
    lastLog >= 5 &&
    stats.startedDaysAgo !== null &&
    stats.startedDaysAgo > 0
  ) {
    return "amber";
  }
  return "green";
}

export const CASE_HEALTH_LABEL: Record<CaseHealth, string> = {
  red: "需注意",
  amber: "留意",
  green: "正常",
};
