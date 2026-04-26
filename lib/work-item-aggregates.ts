import type { DailyLogWorkItem } from "./types";

export type WorkItemAggregate = {
  /** 第一次填寫鎖定的模式;後續填寫只能用同一模式 */
  mode: "absolute" | "percent";
  /** 已累積數量(absolute mode 為單位數量；percent mode 為 0-1 fraction 之總和) */
  total: number;
};

/** caseId → workItemId → aggregate */
export type WorkItemAggregateMap = Record<
  string,
  Record<string, WorkItemAggregate>
>;

type AggregateLog = {
  id: string;
  case_id: string;
  created_at: string;
  work_items: DailyLogWorkItem[] | null;
};

/**
 * 從歷史日誌計算各工項在各案件的「目前累計」與「鎖定模式」。
 * - 鎖定模式 = 該工項最早一筆 fill 所用的 mode
 * - 累計 = 同一 mode 的所有 fill qty 加總(mode 不同的舊資料忽略,屬於 legacy 容錯)
 *
 * @param logs       已從 daily_logs 撈出的紀錄(建議只含 submitted/approved)
 * @param excludeId  編輯模式時當前正在改的 log_id,避免自我重複計算
 */
export function computeWorkItemAggregates(
  logs: AggregateLog[],
  excludeId?: string,
): WorkItemAggregateMap {
  const sorted = [...logs].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
  );
  const result: WorkItemAggregateMap = {};
  for (const log of sorted) {
    if (excludeId && log.id === excludeId) continue;
    const caseMap = (result[log.case_id] ??= {});
    for (const wi of log.work_items ?? []) {
      if (!wi || typeof wi.qty !== "number" || !Number.isFinite(wi.qty)) continue;
      const mode: "absolute" | "percent" = wi.qty_mode ?? "absolute";
      const existing = caseMap[wi.work_item_id];
      if (!existing) {
        caseMap[wi.work_item_id] = { mode, total: wi.qty };
      } else if (existing.mode === mode) {
        existing.total += wi.qty;
      }
    }
  }
  return result;
}
