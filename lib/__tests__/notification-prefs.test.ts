import { describe, expect, it } from "vitest";
import {
  CATEGORY_KEYS,
  EVENT_CATEGORY,
  ROLE_DEFAULT_PREFS,
  ROLE_RECOMMENDED_PREFS,
  isCategoryEnabled,
  resolvePrefs,
} from "@/lib/notifications/prefs";

describe("角色預設矩陣 — 按職責給", () => {
  it("老闆:待核定/日誌結果/請假待簽核 開;請假結果(死項目)/現場回報 關", () => {
    expect(isCategoryEnabled(null, "owner", "logs_to_review")).toBe(true);
    expect(isCategoryEnabled(null, "owner", "log_results")).toBe(true);
    expect(isCategoryEnabled(null, "owner", "leaves_to_review")).toBe(true);
    expect(isCategoryEnabled(null, "owner", "leave_results")).toBe(false);
    expect(isCategoryEnabled(null, "owner", "field_reports")).toBe(false);
  });

  it("助理:日誌結果(不寫日誌)關,其餘職責項目開", () => {
    expect(isCategoryEnabled(null, "office_staff", "logs_to_review")).toBe(true);
    expect(isCategoryEnabled(null, "office_staff", "log_results")).toBe(false);
    expect(isCategoryEnabled(null, "office_staff", "leaves_to_review")).toBe(true);
    expect(isCategoryEnabled(null, "office_staff", "leave_results")).toBe(true);
    expect(isCategoryEnabled(null, "office_staff", "field_reports")).toBe(true);
  });

  it("主任 / 現場人員:白名單制,預設全關", () => {
    for (const key of CATEGORY_KEYS) {
      expect(isCategoryEnabled(null, "site_supervisor", key)).toBe(false);
      expect(isCategoryEnabled(undefined, "field_assistant", key)).toBe(false);
    }
  });

  it("預設與建議矩陣涵蓋所有角色 × 所有分類", () => {
    for (const matrix of [ROLE_DEFAULT_PREFS, ROLE_RECOMMENDED_PREFS]) {
      for (const role of [
        "owner",
        "office_staff",
        "site_supervisor",
        "field_assistant",
      ] as const) {
        expect(Object.keys(matrix[role]).sort()).toEqual(
          [...CATEGORY_KEYS].sort(),
        );
      }
    }
  });

  it("建議值:主任開 日誌結果+請假待簽核+請假結果;現場人員只開 請假結果", () => {
    const sup = ROLE_RECOMMENDED_PREFS.site_supervisor;
    expect(sup.log_results).toBe(true);
    expect(sup.leaves_to_review).toBe(true);
    expect(sup.leave_results).toBe(true);
    expect(sup.logs_to_review).toBe(false);
    const fa = ROLE_RECOMMENDED_PREFS.field_assistant;
    expect(fa.leave_results).toBe(true);
    expect(
      CATEGORY_KEYS.filter((k) => fa[k]),
    ).toEqual(["leave_results"]);
  });

  it("明確設定值蓋過角色預設(開主任的、關老闆的)", () => {
    expect(
      isCategoryEnabled({ log_results: true }, "site_supervisor", "log_results"),
    ).toBe(true);
    expect(
      isCategoryEnabled({ logs_to_review: false }, "owner", "logs_to_review"),
    ).toBe(false);
  });

  it("部分設定:有值的用值,缺的 key 走角色預設", () => {
    const prefs = { log_results: true };
    expect(isCategoryEnabled(prefs, "site_supervisor", "log_results")).toBe(true);
    expect(isCategoryEnabled(prefs, "site_supervisor", "leaves_to_review")).toBe(
      false,
    );
  });

  it("resolvePrefs 回傳每個分類的生效值", () => {
    const resolved = resolvePrefs({ field_reports: true }, "field_assistant");
    expect(resolved.field_reports).toBe(true);
    expect(resolved.logs_to_review).toBe(false);
    expect(Object.keys(resolved).sort()).toEqual([...CATEGORY_KEYS].sort());
  });
});

describe("EVENT_CATEGORY — events.ts 送出的每種事件都要有分類", () => {
  // events.ts 實際使用的 event_type 清單;新增事件時兩邊都要更新
  const EMITTED_EVENTS = [
    "log_submitted",
    "log_to_approve",
    "log_batch_to_approve",
    "log_approved",
    "log_batch_approved",
    "log_rejected",
    "leave_submitted",
    "leave_advanced",
    "leave_approved",
    "leave_rejected",
    "field_report_created",
  ];

  it("全部事件都對到合法分類", () => {
    for (const evt of EMITTED_EVENTS) {
      const cat = EVENT_CATEGORY[evt];
      expect(cat, `事件 ${evt} 沒登記分類`).toBeDefined();
      expect(CATEGORY_KEYS).toContain(cat);
    }
  });
});
