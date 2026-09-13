import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canEndorseLog,
  findEndorsedLogIds,
  omitReviewStage,
} from "../approvals/review-stage";
import { STAGE_FOR_ROLE } from "../approvals/stages";

/** 審閱人加簽(2026-09-13):跟流程無關、只留系統、不進 PDF。 */

describe("canEndorseLog — 辦公室審核通過後才能加簽", () => {
  it("停在核定關 / 已核定 → 可以", () => {
    expect(canEndorseLog({ status: "submitted", current_stage: "approve" })).toBe(true);
    expect(canEndorseLog({ status: "approved", current_stage: null })).toBe(true);
  });
  it("草稿 / 審核中 / 退回 → 不行", () => {
    expect(canEndorseLog({ status: "draft", current_stage: null })).toBe(false);
    expect(canEndorseLog({ status: "submitted", current_stage: "audit" })).toBe(false);
    expect(canEndorseLog({ status: "rejected", current_stage: null })).toBe(false);
  });
});

function stubClient(rows: { log_id: string; created_at: string }[]): SupabaseClient {
  const q = {
    select() {
      return q;
    },
    eq() {
      return q;
    },
    in() {
      return q;
    },
    then(resolve: (v: unknown) => void) {
      resolve({ data: rows, error: null });
    },
  };
  return { from: () => q } as unknown as SupabaseClient;
}

describe("findEndorsedLogIds — 同一輪只算一次", () => {
  it("這一輪簽過的算,退回重送前那輪的不算", async () => {
    const client = stubClient([
      { log_id: "a", created_at: "2026-09-10T00:00:00Z" },
      { log_id: "b", created_at: "2026-09-01T00:00:00Z" },
    ]);
    const signed = await findEndorsedLogIds(client, "me", [
      { id: "a", submitted_at: "2026-09-09T00:00:00Z" },
      { id: "b", submitted_at: "2026-09-05T00:00:00Z" }, // 重送在簽名之後 → 舊輪
      { id: "c", submitted_at: "2026-09-09T00:00:00Z" },
    ]);
    expect([...signed].sort()).toEqual(["a"]);
  });
  it("submitted_at 缺值 → 保守當已簽", async () => {
    const client = stubClient([{ log_id: "a", created_at: "2026-01-01T00:00:00Z" }]);
    const signed = await findEndorsedLogIds(client, "me", [{ id: "a", submitted_at: null }]);
    expect(signed.has("a")).toBe(true);
  });
  it("沒有日誌就不查", async () => {
    const signed = await findEndorsedLogIds(stubClient([]), "me", []);
    expect(signed.size).toBe(0);
  });
});

describe("omitReviewStage — 加簽不進 PDF", () => {
  it("濾掉 stage='review' 的簽名與意見,其餘順序不變", () => {
    const rows = [
      { id: 1, stage: "fill" },
      { id: 2, stage: "audit" },
      { id: 3, stage: "review" },
      { id: 4, stage: "approve" },
    ];
    expect(omitReviewStage(rows).map((r) => r.id)).toEqual([1, 2, 4]);
  });
});

describe("STAGE_FOR_ROLE — 審閱人沒有關卡", () => {
  it("reviewer 是 null(加簽不是關卡),其他角色不變", () => {
    expect(STAGE_FOR_ROLE.reviewer).toBeNull();
    expect(STAGE_FOR_ROLE.site_supervisor).toBeNull();
    expect(STAGE_FOR_ROLE.office_staff).toBe("audit");
    expect(STAGE_FOR_ROLE.owner).toBe("approve");
  });
});
