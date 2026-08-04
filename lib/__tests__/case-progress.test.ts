import { describe, it, expect } from "vitest";
import {
  computeCaseProgress,
  expectedProgressPct,
  isCaseBehind,
  plannedDaysBetween,
  primaryProgressPct,
  type CaseStats,
  type ProgressItem,
  type ProgressLog,
} from "../case-progress";

function makeStats(over: Partial<CaseStats> = {}): CaseStats {
  return {
    itemCount: 0,
    logCount: 0,
    progressPct: null,
    itemProgressPct: null,
    extraCount: 0,
    unsignedCount: 0,
    photos: [],
    photoTotal: 0,
    startedDaysAgo: null,
    plannedDays: null,
    ...over,
  };
}

const CASE = "case-1";
function item(over: Partial<ProgressItem> & { id: string }): ProgressItem {
  return {
    case_id: CASE,
    item_type: "item",
    quantity: null,
    total_price: null,
    skipped: false,
    ...over,
  };
}
function log(
  work_items: ProgressLog["work_items"],
  status = "approved",
): ProgressLog {
  return { case_id: CASE, status, work_items };
}

describe("computeCaseProgress", () => {
  it("absolute 模式:完成量 / 契約數量", () => {
    const p = computeCaseProgress(
      [item({ id: "a", quantity: 100, total_price: 1000 })],
      [log([{ work_item_id: "a", qty: 25, qty_mode: "absolute" }])],
    );
    expect(p.get(CASE)).toEqual({ valuePct: 25, itemPct: 25 });
  });

  it("percent 模式直接是完成比例 — 契約數量 0 的「式」計價項也算得出來", () => {
    // 舊版寫成 total * qty,total=0 一乘就歸零,主任填 100% 完全不算數
    const p = computeCaseProgress(
      [item({ id: "a", quantity: 0, total_price: 5000 })],
      [log([{ work_item_id: "a", qty: 1, qty_mode: "percent" }])],
    );
    expect(p.get(CASE)?.valuePct).toBe(100);
  });

  it("多天累加,且不會超過 100%", () => {
    const p = computeCaseProgress(
      [item({ id: "a", quantity: 100, total_price: 100 })],
      [
        log([{ work_item_id: "a", qty: 0.6, qty_mode: "percent" }]),
        log([{ work_item_id: "a", qty: 0.7, qty_mode: "percent" }]),
      ],
    );
    expect(p.get(CASE)?.valuePct).toBe(100);
  });

  it("產值加權:貴的工項權重大", () => {
    const p = computeCaseProgress(
      [
        item({ id: "cheap", quantity: 1, total_price: 100 }),
        item({ id: "pricey", quantity: 1, total_price: 900 }),
      ],
      [log([{ work_item_id: "cheap", qty: 1, qty_mode: "absolute" }])],
    );
    // 未加權 = 50%,產值加權 = 100/1000 = 10%
    expect(p.get(CASE)).toEqual({ valuePct: 10, itemPct: 50 });
  });

  it("整案沒有單價時 valuePct 為 null,主數字退回工項完成率", () => {
    const p = computeCaseProgress(
      [item({ id: "a", quantity: 1, total_price: null })],
      [log([{ work_item_id: "a", qty: 1, qty_mode: "absolute" }])],
    );
    expect(p.get(CASE)?.valuePct).toBeNull();
    expect(primaryProgressPct(p.get(CASE))).toBe(100);
  });

  it("草稿不計入,已退回的要計入(退回是修正流程,工不會白做)", () => {
    const items = [item({ id: "a", quantity: 100, total_price: 100 })];
    const entry = [{ work_item_id: "a", qty: 50, qty_mode: "absolute" as const }];
    expect(
      computeCaseProgress(items, [log(entry, "draft")]).get(CASE)?.valuePct,
    ).toBe(0);
    for (const st of ["submitted", "approved", "rejected"]) {
      expect(
        computeCaseProgress(items, [log(entry, st)]).get(CASE)?.valuePct,
      ).toBe(50);
    }
  });

  it("section / extra / unsigned 不進總進度,skipped 不列入分母", () => {
    const p = computeCaseProgress(
      [
        item({ id: "s", item_type: "section" }),
        item({ id: "x", item_type: "extra", quantity: 1, total_price: 999 }),
        item({ id: "u", item_type: "unsigned", quantity: 1, total_price: 999 }),
        item({ id: "skip", quantity: 1, total_price: 999, skipped: true }),
        item({ id: "a", quantity: 1, total_price: 100 }),
      ],
      [log([{ work_item_id: "a", qty: 1, qty_mode: "absolute" }])],
    );
    expect(p.get(CASE)).toEqual({ valuePct: 100, itemPct: 100 });
  });

  it("manual 工項要算(無標單小案只有 manual)", () => {
    const p = computeCaseProgress(
      [item({ id: "m", item_type: "manual", quantity: 4, total_price: null })],
      [log([{ work_item_id: "m", qty: 1, qty_mode: "absolute" }])],
    );
    expect(p.get(CASE)?.itemPct).toBe(25);
  });

  it("引用到已刪除工項時跳過,不會炸掉", () => {
    const p = computeCaseProgress(
      [item({ id: "a", quantity: 1, total_price: 100 })],
      [log([{ work_item_id: "gone", qty: 1, qty_mode: "absolute" }])],
    );
    expect(p.get(CASE)?.valuePct).toBe(0);
  });
});

describe("expectedProgressPct", () => {
  it("線性推算:工期走一半就該做一半", () => {
    expect(
      expectedProgressPct(makeStats({ startedDaysAgo: 50, plannedDays: 100 })),
    ).toBe(50);
  });
  it("超過工期上限 100%", () => {
    expect(
      expectedProgressPct(makeStats({ startedDaysAgo: 200, plannedDays: 100 })),
    ).toBe(100);
  });
  it("日期沒填就回 null(算不出來不判斷)", () => {
    expect(
      expectedProgressPct(makeStats({ startedDaysAgo: 50, plannedDays: null })),
    ).toBeNull();
    expect(
      expectedProgressPct(makeStats({ startedDaysAgo: null, plannedDays: 100 })),
    ).toBeNull();
  });
});

describe("plannedDaysBetween", () => {
  it("算開工到預定完工的天數", () => {
    expect(plannedDaysBetween("2026-01-01", "2026-03-02")).toBe(60);
  });
  it("任一沒填或順序顛倒回 null", () => {
    expect(plannedDaysBetween(null, "2026-03-02")).toBeNull();
    expect(plannedDaysBetween("2026-03-02", null)).toBeNull();
    expect(plannedDaysBetween("2026-03-02", "2026-01-01")).toBeNull();
  });
});

describe("isCaseBehind", () => {
  it("落後預期 20 個百分點以上才算落後", () => {
    // 工期走一半 → 該有 50%
    expect(
      isCaseBehind(
        makeStats({ progressPct: 29, startedDaysAgo: 50, plannedDays: 100 }),
      ),
    ).toBe(true);
    expect(
      isCaseBehind(
        makeStats({ progressPct: 30, startedDaysAgo: 50, plannedDays: 100 }),
      ),
    ).toBe(false);
  });

  it("剛開工進度低不算落後(以前固定 30% 門檻會誤報)", () => {
    expect(
      isCaseBehind(
        makeStats({ progressPct: 2, startedDaysAgo: 5, plannedDays: 300 }),
      ),
    ).toBe(false);
  });

  it("進度高但工期快到了照樣落後", () => {
    expect(
      isCaseBehind(
        makeStats({ progressPct: 70, startedDaysAgo: 95, plannedDays: 100 }),
      ),
    ).toBe(true);
  });

  it("沒進度資料 / 沒工期資料一律不判定", () => {
    expect(
      isCaseBehind(
        makeStats({ progressPct: null, startedDaysAgo: 90, plannedDays: 100 }),
      ),
    ).toBe(false);
    expect(
      isCaseBehind(
        makeStats({ progressPct: 10, startedDaysAgo: 90, plannedDays: null }),
      ),
    ).toBe(false);
  });
});
