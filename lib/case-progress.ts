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
