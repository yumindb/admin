import { describe, expect, it } from "vitest";
import {
  canActOnLeave,
  canApplyLeave,
  getApprovalChain,
  hoursBetween,
  nextStep,
} from "@/lib/leave";

describe("getApprovalChain — 簽核鏈依申請人角色往上送", () => {
  it("現場人員:主任 → 助理 → 老闆", () => {
    expect(getApprovalChain("field_assistant")).toEqual([
      "site_supervisor",
      "office_staff",
      "owner",
    ]);
  });

  it("工地主任:助理 → 老闆", () => {
    expect(getApprovalChain("site_supervisor")).toEqual(["office_staff", "owner"]);
  });

  it("辦公室助理:老闆", () => {
    expect(getApprovalChain("office_staff")).toEqual(["owner"]);
  });

  it("老闆沒有上層 → 空鏈,不能申請", () => {
    expect(getApprovalChain("owner")).toEqual([]);
    expect(canApplyLeave("owner")).toBe(false);
    expect(canApplyLeave("field_assistant")).toBe(true);
  });
});

describe("nextStep — 推進簽核鏈", () => {
  const chain = getApprovalChain("field_assistant");

  it("逐關推進,最後一關回 null(整份 approved)", () => {
    expect(nextStep(chain, "site_supervisor")).toBe("office_staff");
    expect(nextStep(chain, "office_staff")).toBe("owner");
    expect(nextStep(chain, "owner")).toBeNull();
  });

  it("current 為 null 或不在鏈上 → null(防呆)", () => {
    expect(nextStep(chain, null)).toBeNull();
    expect(nextStep(["owner"], "site_supervisor")).toBeNull();
  });
});

describe("hoursBetween — 時數計算(四捨五入到 0.5)", () => {
  it("一般工作日 08:30 → 17:30 = 9 小時", () => {
    expect(hoursBetween("2026-05-01T08:30:00+08:00", "2026-05-01T17:30:00+08:00")).toBe(9);
  });

  it("跨到 0.25 小時會捨入到最近的 0.5", () => {
    // 8:00 → 12:15 = 4.25 → 4.5(Math.round(8.5)/2)
    expect(hoursBetween("2026-05-01T08:00:00+08:00", "2026-05-01T12:15:00+08:00")).toBe(4.5);
  });

  it("結束早於開始 / 無效輸入 → 0", () => {
    expect(hoursBetween("2026-05-02T08:00:00+08:00", "2026-05-01T08:00:00+08:00")).toBe(0);
    expect(hoursBetween("not-a-date", "2026-05-01T08:00:00+08:00")).toBe(0);
  });
});

describe("canActOnLeave — 誰能簽這筆假單", () => {
  const base = {
    status: "pending" as const,
    current_step: "office_staff" as const,
    applicant_id: "user-a",
  };

  it("pending + 輪到我的 role + 不是本人 → 可簽", () => {
    expect(canActOnLeave(base, "office_staff", "user-b")).toBe(true);
  });

  it("不是我的關卡 → 不可簽", () => {
    expect(canActOnLeave(base, "owner", "user-b")).toBe(false);
  });

  it("自己不能簽自己的假單", () => {
    expect(canActOnLeave(base, "office_staff", "user-a")).toBe(false);
  });

  it("已核准 / 已退回的單不能再簽", () => {
    expect(canActOnLeave({ ...base, status: "approved" }, "office_staff", "user-b")).toBe(false);
    expect(canActOnLeave({ ...base, status: "rejected" }, "office_staff", "user-b")).toBe(false);
  });
});
