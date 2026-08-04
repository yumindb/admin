/**
 * 案件進度計算與判斷 helpers — server 與 client 共用，不可加 "use client"。
 *
 * 為什麼分到這裡：cases/page.tsx (server) 與 cases-overview-list.tsx (client)
 * 都要呼叫 isCaseBehind；client component 內 export 的函式不能在 server 直接呼叫
 * （Next 15 限制：「Attempted to call ... from the server but ... is on the client」）。
 *
 * 2026-08-04 重整（業主要求「進度算法要合理」）：
 *   算法本體從三個頁面（案件列表 / 儀表板 / 案件總覽報表）各寫一份，收斂成
 *   computeCaseProgress 一份。三處以前連「要不要算草稿/退回日誌」都不一致。
 */

import type { LogPhoto } from "@/lib/types";

export type CaseStats = {
  itemCount: number;
  logCount: number;
  /** 主進度：完成產值 ÷ 合約總價（%）。沒有單價資料的案件退回 itemProgressPct */
  progressPct: number | null;
  /** 次要進度：工項完成率的算術平均（%）— 「幾成工項動過」的感覺 */
  itemProgressPct: number | null;
  extraCount: number;
  unsignedCount: number;
  photos: LogPhoto[];
  photoTotal: number;
  startedDaysAgo: number | null;
  /** 開工 → 預定完工的總天數。兩個日期都有填才算得出來 */
  plannedDays: number | null;
};

/**
 * 進度只算契約內的葉節點。
 * section 是分類層（沒有自己的量）；extra / unsigned 走各自的區塊，不進總進度。
 * manual 要算 — 無標單的小案只有 manual 工項，漏掉它進度永遠是「—」。
 */
const PROGRESS_ITEM_TYPES = new Set(["item", "spec", "manual"]);

/**
 * 哪些日誌的數量算進度：**除了草稿以外都算**（submitted / approved / rejected）。
 *
 * - draft 不算：還沒送出，只是主任的暫存，內容隨時會變。
 * - rejected 要算：退回多半是補照片、改錯字這類修正，混凝土不會因為日誌被退回就沒灌。
 *   把退回的日誌當成零產值，會讓一份 92 項的日誌被退回時整案進度瞬間掉到 0，
 *   修好重送又跳回來 —— 對老闆來說那是雜訊不是資訊。
 *
 * （以前三個頁面各行其是：案件列表只算 submitted+approved，儀表板與報表連草稿都算。）
 */
const COUNTED_LOG_STATUSES = new Set(["submitted", "approved", "rejected"]);

export type ProgressItem = {
  id: string;
  case_id: string;
  item_type: string;
  quantity: number | null;
  total_price?: number | null;
  skipped?: boolean | null;
};

export type ProgressLogWorkItem = {
  work_item_id: string;
  qty: number;
  qty_mode?: "percent" | "absolute" | null;
};

export type ProgressLog = {
  case_id: string | null;
  status: string;
  work_items: ProgressLogWorkItem[] | null;
};

export type CaseProgress = {
  /** 完成產值 ÷ 合約總價（%）。整案沒有任何單價時為 null */
  valuePct: number | null;
  /** 工項完成率算術平均（%）。沒有可計進度的工項時為 null */
  itemPct: number | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 把一筆日誌記錄換算成「這個工項完成了幾成」(0-1)。
 *
 * ⚠ percent 模式直接就是完成比例，不可以再乘契約數量。
 *   舊版寫成 `total * qty` 換成絕對量、算進度時再除回 total —— 契約數量是 0 的
 *   「式」計價工項（該案 270 項裡有 52 項）一乘就變 0，主任填「這項做完 100%」
 *   完全不算數（2026-08-04 在 YM-2026-001 抓到 11 筆被吃掉）。
 */
function entryFraction(entry: ProgressLogWorkItem, itemQuantity: number | null): number {
  if (entry.qty_mode === "percent") return entry.qty;
  const total = itemQuantity ?? 0;
  if (total > 0) return entry.qty / total;
  // 沒有契約數量的計價工項用 absolute 填：填了正數就當這次做完
  return entry.qty > 0 ? 1 : 0;
}

/**
 * 算每個案件的進度。items / logs 可以跨案件混著傳，用 case_id 分群。
 */
export function computeCaseProgress(
  items: ProgressItem[],
  logs: ProgressLog[],
): Map<string, CaseProgress> {
  const metaById = new Map<string, ProgressItem>();
  for (const it of items) metaById.set(it.id, it);

  // 1) 每個工項的累計完成比例
  const fracByItem = new Map<string, number>();
  for (const log of logs) {
    if (!COUNTED_LOG_STATUSES.has(log.status)) continue;
    for (const w of log.work_items ?? []) {
      const meta = metaById.get(w.work_item_id);
      if (!meta) continue; // 工項已被刪 → 無從換算（正常情況不該發生）
      const frac = entryFraction(w, meta.quantity);
      fracByItem.set(w.work_item_id, (fracByItem.get(w.work_item_id) ?? 0) + frac);
    }
  }

  // 2) 依案件彙總：產值加權 + 未加權各算一份
  type Acc = { valueDone: number; valueTotal: number; pctSum: number; n: number };
  const acc = new Map<string, Acc>();
  for (const it of items) {
    if (!PROGRESS_ITEM_TYPES.has(it.item_type)) continue;
    if (it.skipped) continue; // 勾「略過」的工項不列入分母
    const pct = Math.min(1, Math.max(0, fracByItem.get(it.id) ?? 0));
    const price = it.total_price ?? 0;
    const a = acc.get(it.case_id) ?? { valueDone: 0, valueTotal: 0, pctSum: 0, n: 0 };
    a.valueDone += pct * price;
    a.valueTotal += price;
    a.pctSum += pct;
    a.n += 1;
    acc.set(it.case_id, a);
  }

  const out = new Map<string, CaseProgress>();
  for (const [caseId, a] of acc) {
    out.set(caseId, {
      valuePct: a.valueTotal > 0 ? round1((a.valueDone / a.valueTotal) * 100) : null,
      itemPct: a.n > 0 ? round1((a.pctSum / a.n) * 100) : null,
    });
  }
  return out;
}

/**
 * 卡片/ 報表要顯示的主數字：有單價就用產值加權，整案沒單價才退回工項完成率。
 *
 * 為什麼以產值為主：未加權平均把 NT$223,000 的「配線另料」跟 NT$535 的 D-FUSE
 * 各算 1/270。小項做完一堆、大項還沒動時會嚴重高估（YM-2026-001 未加權 23.8%、
 * 產值加權只有 3.4%）。要跟請款進度對得上就得看產值。
 */
export function primaryProgressPct(p: CaseProgress | undefined | null): number | null {
  if (!p) return null;
  return p.valuePct ?? p.itemPct;
}

/** 開工天數（沒填開工日回 null） */
export function daysSince(date: string | null, today: Date = new Date()): number | null {
  if (!date) return null;
  const dt = new Date(date);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.floor((today.getTime() - dt.getTime()) / (1000 * 60 * 60 * 24));
}

/** 開工 → 預定完工的總天數（任一沒填回 null） */
export function plannedDaysBetween(
  startedAt: string | null,
  expectedEnd: string | null,
): number | null {
  if (!startedAt || !expectedEnd) return null;
  const a = new Date(startedAt);
  const b = new Date(expectedEnd);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const days = Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  return days > 0 ? days : null;
}

/**
 * 照工期推算「今天應該做到幾 %」— 線性假設（沒有 S 曲線資料，也不需要那麼精細）。
 * 開工日或預定完工日沒填就回 null：算不出來就不判斷，不亂報警。
 */
export function expectedProgressPct(stats: CaseStats): number | null {
  if (stats.startedDaysAgo === null || stats.plannedDays === null) return null;
  if (stats.plannedDays <= 0) return null;
  return Math.min(100, Math.max(0, (stats.startedDaysAgo / stats.plannedDays) * 100));
}

/** 落後多少個百分點才算「落後」 */
export const BEHIND_GAP_PP = 20;

/**
 * 進度落後判斷：實際進度比「照工期該有的進度」低 BEHIND_GAP_PP 個百分點以上。
 *
 * 2026-08-04 從「< 30% 且開工 > 60 天」改過來：固定門檻在產值加權下沒有意義
 * （新開的案子產值本來就接近 0，會整排變紅燈），要比的是「跟工期相比落後多少」。
 * ⚠ 需要 cases.started_at + cases.expected_end 都有填才會作動。
 */
export function isCaseBehind(stats: CaseStats): boolean {
  if (stats.progressPct === null) return false;
  const expected = expectedProgressPct(stats);
  if (expected === null) return false;
  return stats.progressPct < expected - BEHIND_GAP_PP;
}

/**
 * 案場健康度紅綠燈 — Phil 視角:不要冷冰冰的進度 %，要紅綠燈一眼看出狀況。
 *
 * 規則(優先順序高到低):
 *   - 🔴 紅:進度落後(比工期該有的進度低 20 個百分點以上) — 嚴重
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
