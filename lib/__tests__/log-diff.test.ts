import { describe, it, expect } from "vitest";
import { buildRevisionDiffs, diffSnapshot } from "../log-diff";
import type { DailyLogSnapshot } from "../types";

const EMPTY: DailyLogSnapshot = {
  log_date: "2026-08-01",
  weather: null,
  manpower: {},
  work_items: [],
  extra_items: [],
  unsigned_items: [],
  photos: [],
  vendor_notices: null,
  notes: null,
};

const lookup = (id: string) =>
  id === "wi-1"
    ? { name: "打石工程", unit: "M2" }
    : id === "wi-2"
      ? { name: "清運", unit: "車" }
      : null;

describe("diffSnapshot", () => {
  it("出工 / 點工 / 點工備註 各自列一行", () => {
    const before = {
      ...EMPTY,
      manpower: { today_total: 5, day_labor: 0, day_labor_note: "" },
    };
    const after = {
      ...EMPTY,
      manpower: { today_total: 6, day_labor: 2, day_labor_note: "清運廢料" },
    };
    const [change] = diffSnapshot(before, after, ["manpower"], lookup);
    expect(change.rows).toEqual([
      { label: "本日出工人數", before: "5", after: "6" },
      { label: "本日點工人數", before: "0", after: "2" },
      { label: "點工工作內容", before: "（空白）", after: "清運廢料" },
    ]);
  });

  it("工項數量改動帶出工項名稱與單位", () => {
    const before = {
      ...EMPTY,
      work_items: [{ work_item_id: "wi-1", qty: 10 }],
    };
    const after = {
      ...EMPTY,
      work_items: [{ work_item_id: "wi-1", qty: 15 }],
    };
    const [change] = diffSnapshot(before, after, ["work_items"], lookup);
    expect(change.rows).toEqual([
      { label: "打石工程", before: "10 M2", after: "15 M2" },
    ]);
  });

  it("助理補上主任漏填的工項 → 標成原本沒有這項", () => {
    const after = {
      ...EMPTY,
      work_items: [{ work_item_id: "wi-2", qty: 3 }],
    };
    const [change] = diffSnapshot(EMPTY, after, ["work_items"], lookup);
    expect(change.rows[0]).toEqual({
      label: "清運",
      before: "（原本沒有這項）",
      after: "3 車",
    });
  });

  it("percent 模式的工項換算成百分比", () => {
    const before = {
      ...EMPTY,
      work_items: [{ work_item_id: "wi-1", qty: 0.3, qty_mode: "percent" as const }],
    };
    const after = {
      ...EMPTY,
      work_items: [{ work_item_id: "wi-1", qty: 0.55, qty_mode: "percent" as const }],
    };
    const [change] = diffSnapshot(before, after, ["work_items"], lookup);
    expect(change.rows).toEqual([
      { label: "打石工程", before: "30%", after: "55%" },
    ]);
  });

  it("工項在 case_work_items 已被刪 → 名稱 fallback 不會爆", () => {
    const before = { ...EMPTY, work_items: [{ work_item_id: "gone", qty: 1 }] };
    const [change] = diffSnapshot(before, EMPTY, ["work_items"], lookup);
    expect(change.rows[0].label).toBe("（工項已刪除）");
    expect(change.rows[0].after).toBe("（已刪除）");
  });

  it("文字欄位顯示原文", () => {
    const before = { ...EMPTY, notes: "原本的備註" };
    const after = { ...EMPTY, notes: "改過的備註" };
    const [change] = diffSnapshot(before, after, ["notes"], lookup);
    expect(change.rows).toEqual([
      { before: "原本的備註", after: "改過的備註" },
    ]);
  });

  it("欄位被標記有變但算不出差異 → 仍列出該欄位,不留空白", () => {
    const [change] = diffSnapshot(EMPTY, EMPTY, ["photos"], lookup);
    expect(change.rows).toHaveLength(1);
    expect(change.label).toBe("照片");
  });
});

describe("buildRevisionDiffs", () => {
  it("新到舊串接:最新一筆的『改後』是現值,其餘接下一筆的快照", () => {
    const current: DailyLogSnapshot = {
      ...EMPTY,
      manpower: { today_total: 9 },
    };
    // 依 edited_at 新到舊:r2(最新)在前
    const revisions = [
      {
        id: "r2",
        snapshot: { ...EMPTY, manpower: { today_total: 7 } },
        changedFields: ["manpower" as const],
      },
      {
        id: "r1",
        snapshot: { ...EMPTY, manpower: { today_total: 5 } },
        changedFields: ["manpower" as const],
      },
    ];
    const out = buildRevisionDiffs(revisions, current, lookup);
    // r2:7 → 9(現值)
    expect(out[0].changes[0].rows[0]).toEqual({
      label: "本日出工人數",
      before: "7",
      after: "9",
    });
    // r1:5 → 7(r2 編輯前的快照)
    expect(out[1].changes[0].rows[0]).toEqual({
      label: "本日出工人數",
      before: "5",
      after: "7",
    });
  });
});
