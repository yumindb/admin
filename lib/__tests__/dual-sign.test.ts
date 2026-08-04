import { describe, it, expect } from "vitest";
import {
  REQUIRED_APPROVE_SIGNATURES,
  findApproveSignedLogIds,
  loadApproveSignersThisRound,
  requiredApproveSignatures,
} from "../approvals/dual-sign";

/**
 * 用 stub client 驗核定簽名規則:
 *   - 「本輪」判斷 — 退回重送後,上一輪的簽名不能算數
 *     (否則第二輪只要一個人簽就會完成)
 *   - 需要幾簽 — 設定開關(migration-2.34)、啟用中的核定人帳號數、查詢失敗時的預設
 */
type Row = Record<string, unknown>;

type StubOpts = {
  /** app_settings 裡 approval.dual_sign_enabled 的值;undefined = 沒有那一列 */
  dualSign?: boolean;
  /** 讀設定時出錯(例:migration 還沒跑) */
  settingsError?: boolean;
  /** 數 profiles 時出錯 */
  profilesError?: boolean;
  /** 收集所有 .eq(col, val) — 用來驗查詢條件真的有下 */
  eqCalls?: [string, unknown][];
};

function stubClient(rows: Row[], count?: number, opts: StubOpts = {}) {
  const makeChain = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.select = self;
    chain.in = self;
    chain.eq = (col: string, val: unknown) => {
      opts.eqCalls?.push([col, val]);
      return chain;
    };
    chain.order = () => Promise.resolve({ data: rows, error: null });
    chain.maybeSingle = () => {
      if (table === "app_settings") {
        if (opts.settingsError) {
          return Promise.resolve({
            data: null,
            error: { code: "42P01", message: "app_settings 不存在" },
          });
        }
        return Promise.resolve({
          data: opts.dualSign === undefined ? null : { value: opts.dualSign },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    // profiles 的 count 查詢:chain 本身是 thenable
    chain.then = (
      resolve: (v: {
        data: Row[] | null;
        error: unknown;
        count?: number | null;
      }) => void,
    ) =>
      resolve(
        opts.profilesError
          ? { data: null, error: { message: "x" }, count: null }
          : { data: rows, error: null, count },
      );
    return chain;
  };
  return { from: (table: string) => makeChain(table) } as never;
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
  it("設定開啟雙簽 + 兩位以上核定人帳號 → 需要兩簽", async () => {
    expect(
      await requiredApproveSignatures(stubClient([], 2, { dualSign: true })),
    ).toBe(2);
    expect(
      await requiredApproveSignatures(stubClient([], 5, { dualSign: true })),
    ).toBe(2);
  });

  it("設定關掉雙簽 → 一簽即可(2026-08-04:第二位核定人未到職)", async () => {
    expect(
      await requiredApproveSignatures(stubClient([], 5, { dualSign: false })),
    ).toBe(1);
  });

  it("沒有設定那一列 → 維持雙簽(預設值要是比較嚴的那一邊)", async () => {
    expect(await requiredApproveSignatures(stubClient([], 2))).toBe(2);
  });

  it("設定表不存在(migration 沒跑)→ 維持雙簽,不因為讀不到就放寬", async () => {
    expect(
      await requiredApproveSignatures(stubClient([], 2, { settingsError: true })),
    ).toBe(2);
  });

  it("只有一位啟用中的核定人 → 退回單簽(不然日誌永遠卡住)", async () => {
    expect(
      await requiredApproveSignatures(stubClient([], 1, { dualSign: true })),
    ).toBe(1);
  });

  it("數核定人時只算啟用中的(停用的離職者不能被當成第二簽)", async () => {
    const eqCalls: [string, unknown][] = [];
    await requiredApproveSignatures(stubClient([], 2, { dualSign: true, eqCalls }));
    expect(eqCalls).toContainEqual(["role", "owner"]);
    expect(eqCalls).toContainEqual(["is_active", true]);
  });

  it("數帳號失敗 → 用預設值,不因為查不到就放寬", async () => {
    expect(
      await requiredApproveSignatures(
        stubClient([], undefined, { dualSign: true, profilesError: true }),
      ),
    ).toBe(REQUIRED_APPROVE_SIGNATURES);
  });
});
