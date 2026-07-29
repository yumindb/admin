import { describe, it, expect } from "vitest";
import {
  REQUIRED_APPROVE_SIGNATURES,
  findApproveSignedLogIds,
  loadApproveSignersThisRound,
  requiredApproveSignatures,
} from "../approvals/dual-sign";

/**
 * 用 stub client 驗核定雙簽的「本輪」判斷 —
 * 退回重送後,上一輪的簽名不能算數(否則第二輪只要一個人簽就會完成)。
 */
type Row = Record<string, unknown>;

function stubClient(rows: Row[], count?: number) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => Promise.resolve({ data: rows, error: null }),
    then: (resolve: (v: { data: Row[]; error: null; count?: number }) => void) =>
      resolve({ data: rows, error: null, count }),
  };
  return { from: () => chain } as never;
}

describe("findApproveSignedLogIds", () => {
  it("只算本輪(created_at >= submitted_at)的簽名", async () => {
    const client = stubClient([
      // 上一輪簽的 — 退回後重送,不算
      { log_id: "a", created_at: "2026-07-01T00:00:00Z" },
      // 本輪簽的
      { log_id: "b", created_at: "2026-07-10T05:00:00Z" },
    ]);
    const signed = await findApproveSignedLogIds(client, "user-1", [
      { id: "a", submitted_at: "2026-07-05T00:00:00Z" },
      { id: "b", submitted_at: "2026-07-10T00:00:00Z" },
    ]);
    expect(signed.has("a")).toBe(false);
    expect(signed.has("b")).toBe(true);
  });

  it("submitted_at 缺值時保守視為本輪(寧可少顯示也不要重複簽)", async () => {
    const client = stubClient([{ log_id: "a", created_at: "2026-07-01T00:00:00Z" }]);
    const signed = await findApproveSignedLogIds(client, "user-1", [
      { id: "a", submitted_at: null },
    ]);
    expect(signed.has("a")).toBe(true);
  });

  it("沒有日誌就不查 DB", async () => {
    const signed = await findApproveSignedLogIds(stubClient([]), "user-1", []);
    expect(signed.size).toBe(0);
  });
});

describe("loadApproveSignersThisRound", () => {
  it("濾掉上一輪的簽名,保留本輪的兩位", async () => {
    const client = stubClient([
      { approver_id: "boss-1", created_at: "2026-07-01T00:00:00Z" }, // 上一輪
      { approver_id: "boss-1", created_at: "2026-07-10T01:00:00Z" },
      { approver_id: "boss-2", created_at: "2026-07-10T02:00:00Z" },
    ]);
    const signers = await loadApproveSignersThisRound(
      client,
      "log-1",
      "2026-07-10T00:00:00Z",
    );
    expect(signers.map((s) => s.approverId)).toEqual(["boss-1", "boss-2"]);
  });
});

describe("requiredApproveSignatures", () => {
  it("兩位以上老闆帳號 → 需要兩簽", async () => {
    expect(await requiredApproveSignatures(stubClient([], 2))).toBe(2);
    expect(await requiredApproveSignatures(stubClient([], 5))).toBe(2);
  });

  it("只有一位老闆帳號 → 退回單簽(不然日誌永遠卡住)", async () => {
    expect(await requiredApproveSignatures(stubClient([], 1))).toBe(1);
  });

  it("查詢失敗 → 用預設值,不因為查不到就放寬", async () => {
    const failing = {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: null, error: { message: "x" }, count: null }),
        }),
      }),
    } as never;
    expect(await requiredApproveSignatures(failing)).toBe(
      REQUIRED_APPROVE_SIGNATURES,
    );
  });
});
