import { describe, expect, it } from "vitest";
import {
  CATEGORY_KEYS,
  EVENT_CATEGORY,
  isCategoryEnabled,
  resolvePrefs,
  roleDefaultEnabled,
} from "@/lib/notifications/prefs";

describe("角色預設 — 白名單制", () => {
  it("owner / office_staff 預設開;主任 / 現場人員預設關", () => {
    expect(roleDefaultEnabled("owner")).toBe(true);
    expect(roleDefaultEnabled("office_staff")).toBe(true);
    expect(roleDefaultEnabled("site_supervisor")).toBe(false);
    expect(roleDefaultEnabled("field_assistant")).toBe(false);
  });

  it("沒設定過(null)→ 全走角色預設", () => {
    expect(isCategoryEnabled(null, "office_staff", "logs_to_review")).toBe(true);
    expect(isCategoryEnabled(null, "site_supervisor", "log_results")).toBe(false);
    expect(isCategoryEnabled(undefined, "field_assistant", "leave_results")).toBe(
      false,
    );
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
