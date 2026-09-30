import { describe, expect, it } from "vitest";
import { isMeaningfulReason, pickRejectReason } from "@/lib/logs/rejected";

describe("isMeaningfulReason", () => {
  it("只有標點 / 空白算沒寫", () => {
    expect(isMeaningfulReason(".")).toBe(false);
    expect(isMeaningfulReason(" 。、 ")).toBe(false);
    expect(isMeaningfulReason("")).toBe(false);
    expect(isMeaningfulReason(null)).toBe(false);
  });
  it("有中文或數字就算", () => {
    expect(isMeaningfulReason("工項漏報")).toBe(true);
    expect(isMeaningfulReason("8?")).toBe(true);
  });
});

describe("pickRejectReason", () => {
  it("最新一筆是「.」時退回去用老闆前一次寫的", () => {
    expect(
      pickRejectReason([{ comment: "." }, { comment: "工項漏報\n電線數量漏報" }]),
    ).toBe("工項漏報\n電線數量漏報");
  });
  it("取最新一筆有內容的", () => {
    expect(pickRejectReason([{ comment: "新原因" }, { comment: "舊原因" }])).toBe("新原因");
  });
  it("都沒寫回 null", () => {
    expect(pickRejectReason([{ comment: "." }, { comment: null }])).toBeNull();
    expect(pickRejectReason([])).toBeNull();
  });
});
