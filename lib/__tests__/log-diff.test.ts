import { describe, it, expect } from "vitest";
import { buildRevisionDiffs, diffSnapshot, stableStringify } from "../log-diff";
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

  it("欄位被標記有變但實際沒差 → 整個欄位不列(jsonb key 順序造成的誤判)", () => {
    expect(diffSnapshot(EMPTY, EMPTY, ["photos", "manpower"], lookup)).toEqual([]);
  });

  it("同一張照片存成 signed URL 與 storage path → 不算被更換", () => {
    const path = "uid-1/1785242484443-lhj1fb.jpg";
    const before = { ...EMPTY, photos: [{ path, caption: "" }] };
    const after = {
      ...EMPTY,
      photos: [
        {
          path: `https://xxx.supabase.co/storage/v1/object/sign/daily-photos/${path}?token=abc.def`,
          caption: "",
        },
      ],
    };
    expect(diffSnapshot(before, after, ["photos"], lookup)).toEqual([]);
  });

  it("照片說明被改 → 跨 signed URL / path 仍對得上同一張", () => {
    const path = "uid-1/a.jpg";
    const before = { ...EMPTY, photos: [{ path, caption: "舊說明" }] };
    const after = {
      ...EMPTY,
      photos: [
        {
          path: `https://x/storage/v1/object/sign/daily-photos/${path}?token=zz`,
          caption: "新說明",
        },
      ],
    };
    const [change] = diffSnapshot(before, after, ["photos"], lookup);
    expect(change.rows).toEqual([
      { label: "照片說明", before: "舊說明", after: "新說明" },
    ]);
  });

  it("工項一次動很多筆 → 給總結,明細只列前 8 筆", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      work_item_id: `wi-${i}`,
      qty: 1,
    }));
    const [change] = diffSnapshot(
      EMPTY,
      { ...EMPTY, work_items: many },
      ["work_items"],
      lookup,
    );
    expect(change.rows).toHaveLength(8);
    expect(change.more).toBe(12);
    expect(change.summary).toBe("新增 20 項");
  });
});

describe("stableStringify", () => {
  it("key 順序不同但內容相同 → 視為沒變", () => {
    const fromDb = { machines: [], subcontractors: [], today_total: 3 };
    const fromClient = { today_total: 3, subcontractors: [], machines: [] };
    expect(stableStringify(fromDb)).toBe(stableStringify(fromClient));
    // 對照:原本的比法會誤判成有變
    expect(JSON.stringify(fromDb)).not.toBe(JSON.stringify(fromClient));
  });

  it("內容真的不同仍然判得出來", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it("陣列順序有意義,不排序", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("undefined 欄位忽略(client 端沒填的欄位不算差異)", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
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
