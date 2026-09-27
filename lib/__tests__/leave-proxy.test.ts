import { describe, expect, it } from "vitest";
import {
  PROXY_GRACE_DAYS,
  addDaysToDate,
  canBeProxy,
  canDesignateProxy,
  defaultProxyLogDate,
  formatDateWindow,
  formatProxyFiller,
  isWindowActive,
  isWindowUpcoming,
  leaveDateRange,
  proxyGraceEnd,
  splitDelegations,
  windowCoversDate,
  type ProxyDelegation,
} from "@/lib/leave-proxy";

describe("誰能指定 / 被指定代理人", () => {
  it("只有工地主任的假單能指定代理人", () => {
    expect(canDesignateProxy("site_supervisor")).toBe(true);
    expect(canDesignateProxy("field_assistant")).toBe(false);
    expect(canDesignateProxy("office_staff")).toBe(false);
    expect(canDesignateProxy("owner")).toBe(false);
    expect(canDesignateProxy("reviewer")).toBe(false);
  });

  it("代理人只能是現場人員(其他主任本來就能寫任何案件的日誌)", () => {
    expect(canBeProxy("field_assistant")).toBe(true);
    expect(canBeProxy("site_supervisor")).toBe(false);
    expect(canBeProxy("office_staff")).toBe(false);
  });
});

describe("leaveDateRange — 請假涵蓋的台北日期", () => {
  it("9/28 09:00 ~ 9/30 18:00(台北)= 9/28 ~ 9/30", () => {
    expect(
      leaveDateRange("2026-09-28T01:00:00.000Z", "2026-09-30T10:00:00.000Z"),
    ).toEqual({ startDate: "2026-09-28", endDate: "2026-09-30" });
  });

  it("結束剛好是隔天 00:00 → 那天不算", () => {
    // 10/1 00:00 台北 = 9/30 16:00 UTC
    expect(
      leaveDateRange("2026-09-28T01:00:00.000Z", "2026-09-30T16:00:00.000Z"),
    ).toEqual({ startDate: "2026-09-28", endDate: "2026-09-30" });
  });

  it("用台北日期,不是 UTC(台北凌晨 1 點 = UTC 前一天 17 點)", () => {
    expect(
      leaveDateRange("2026-09-27T17:00:00.000Z", "2026-09-28T05:00:00.000Z"),
    ).toEqual({ startDate: "2026-09-28", endDate: "2026-09-28" });
  });
});

describe("addDaysToDate", () => {
  it("跨月、跨年、往回推都對", () => {
    expect(addDaysToDate("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysToDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysToDate("2026-09-28", 0)).toBe("2026-09-28");
  });
});

describe("代理期間判斷", () => {
  const w = { startDate: "2026-09-28", endDate: "2026-09-30" };

  it("只能填請假那幾天的日誌(含頭尾)", () => {
    expect(windowCoversDate(w, "2026-09-27")).toBe(false);
    expect(windowCoversDate(w, "2026-09-28")).toBe(true);
    expect(windowCoversDate(w, "2026-09-30")).toBe(true);
    expect(windowCoversDate(w, "2026-10-01")).toBe(false);
  });

  it(`入口開到請假最後一天 + ${PROXY_GRACE_DAYS} 天(補寫最後一天)`, () => {
    expect(isWindowActive(w, "2026-09-27")).toBe(false);
    expect(isWindowActive(w, "2026-09-28")).toBe(true);
    expect(isWindowActive(w, "2026-10-03")).toBe(true);
    expect(isWindowActive(w, "2026-10-04")).toBe(false);
    expect(proxyGraceEnd(w)).toBe("2026-10-03");
  });

  it("一週內要開始的算「即將代理」,更遠的先不顯示", () => {
    expect(isWindowUpcoming(w, "2026-09-21")).toBe(true);
    expect(isWindowUpcoming(w, "2026-09-20")).toBe(false);
    expect(isWindowUpcoming(w, "2026-09-28")).toBe(false); // 已經開始 → 進行中,不是即將
  });

  it("新日誌預設日期:期間內用今天、過了用最後一天、還沒到用第一天", () => {
    expect(defaultProxyLogDate(w, "2026-09-29")).toBe("2026-09-29");
    expect(defaultProxyLogDate(w, "2026-10-02")).toBe("2026-09-30");
    expect(defaultProxyLogDate(w, "2026-09-26")).toBe("2026-09-28");
  });
});

describe("顯示", () => {
  it("formatDateWindow:同一天只寫一次", () => {
    expect(formatDateWindow({ startDate: "2026-09-28", endDate: "2026-09-30" })).toBe(
      "9/28–9/30",
    );
    expect(formatDateWindow({ startDate: "2026-10-05", endDate: "2026-10-05" })).toBe(
      "10/5",
    );
  });

  it("formatProxyFiller:代理日誌註明替誰填", () => {
    expect(formatProxyFiller("王小明", "陳大明")).toBe("王小明（代理 陳大明）");
    expect(formatProxyFiller("陳大明", null)).toBe("陳大明");
    expect(formatProxyFiller("陳大明", undefined)).toBe("陳大明");
  });
});

describe("splitDelegations", () => {
  const d = (
    leaveId: string,
    startDate: string,
    endDate: string,
  ): ProxyDelegation => ({
    leaveId,
    supervisorId: `sup-${leaveId}`,
    supervisorName: `主任${leaveId}`,
    status: "approved",
    startDate,
    endDate,
  });

  it("依今天分成進行中 / 即將開始,太遠或過了寬限的不顯示,各自依開始日排序", () => {
    const today = "2026-09-29";
    const { active, upcoming } = splitDelegations(
      [
        d("later", "2026-10-02", "2026-10-02"), // 即將
        d("now", "2026-09-28", "2026-09-30"), // 進行中
        d("grace", "2026-09-25", "2026-09-26"), // 結束 3 天內 → 進行中(補寫)
        d("old", "2026-09-20", "2026-09-22"), // 過了寬限
        d("far", "2026-10-10", "2026-10-11"), // 太遠
        d("soon", "2026-10-01", "2026-10-01"), // 即將
      ],
      today,
    );
    expect(active.map((x) => x.leaveId)).toEqual(["grace", "now"]);
    expect(upcoming.map((x) => x.leaveId)).toEqual(["soon", "later"]);
  });
});
