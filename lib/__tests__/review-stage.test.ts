import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isReviewStageActive,
  omitReviewStage,
  stageAfterAudit,
} from "../approvals/review-stage";
import { STAGE_FOR_ROLE } from "../approvals/stages";

/**
 * 審閱關(2026-09-09,取代雙簽)。
 * stub 只模擬兩張表:app_settings(開關)與 profiles(啟用中的審閱人數)。
 */
function stubClient(opts: {
  setting?: boolean | string | null;
  settingsError?: boolean;
  reviewerCount?: number | null;
  countError?: boolean;
}): SupabaseClient {
  const client = {
    from(table: string) {
      if (table === "app_settings") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            if (opts.settingsError) {
              return { data: null, error: { code: "PGRST205", message: "missing" } };
            }
            return {
              data: opts.setting === undefined ? null : { value: opts.setting },
              error: null,
            };
          },
        };
      }
      if (table === "profiles") {
        const q = {
          select() {
            return q;
          },
          eq() {
            return q;
          },
          then(resolve: (v: unknown) => void) {
            resolve(
              opts.countError
                ? { count: null, error: { message: "boom" } }
                : { count: opts.reviewerCount ?? 0, error: null },
            );
          },
        };
        return q;
      }
      throw new Error("unexpected table " + table);
    },
  };
  return client as unknown as SupabaseClient;
}

describe("isReviewStageActive", () => {
  it("開關開 + 有啟用中的審閱人 → 跑", async () => {
    expect(await isReviewStageActive(stubClient({ setting: true, reviewerCount: 1 }))).toBe(true);
  });
  it("開關開但沒有審閱人 → 自動跳過(不能讓日誌卡在沒人能簽的關)", async () => {
    expect(await isReviewStageActive(stubClient({ setting: true, reviewerCount: 0 }))).toBe(false);
  });
  it("開關關 → 不跑,連 profiles 都不用查", async () => {
    expect(await isReviewStageActive(stubClient({ setting: false, reviewerCount: 3 }))).toBe(false);
  });
  it("設定讀不到(migration 沒跑)→ 當關 = 上線前的三關流程", async () => {
    expect(await isReviewStageActive(stubClient({ settingsError: true, reviewerCount: 3 }))).toBe(false);
    expect(await isReviewStageActive(stubClient({ reviewerCount: 3 }))).toBe(false);
  });
  it("字串 'true' 也認", async () => {
    expect(await isReviewStageActive(stubClient({ setting: "true", reviewerCount: 1 }))).toBe(true);
  });
  it("審閱人數查失敗 → 保守當沒有", async () => {
    expect(await isReviewStageActive(stubClient({ setting: true, countError: true }))).toBe(false);
  });
});

describe("stageAfterAudit", () => {
  it("有審閱關 → review;沒有 → approve", async () => {
    expect(await stageAfterAudit(stubClient({ setting: true, reviewerCount: 1 }))).toBe("review");
    expect(await stageAfterAudit(stubClient({ setting: false }))).toBe("approve");
  });
});

describe("omitReviewStage — 審閱關不進 PDF", () => {
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

describe("STAGE_FOR_ROLE", () => {
  it("審閱人對 review、主任沒有關卡、核定人對 approve", () => {
    expect(STAGE_FOR_ROLE.reviewer).toBe("review");
    expect(STAGE_FOR_ROLE.site_supervisor).toBeNull();
    expect(STAGE_FOR_ROLE.office_staff).toBe("audit");
    expect(STAGE_FOR_ROLE.owner).toBe("approve");
    expect(STAGE_FOR_ROLE.field_assistant).toBeNull();
  });
});
