import { describe, it, expect } from "vitest";
import { cleanupOldLogs, RETENTION_DAYS } from "../retention";

/**
 * retention 清理用的「表 ↔ 時間欄位」對應。
 * 這裡的欄位名要跟 docs/schema.sql / migration-*.sql 一致 —
 * login_attempts(attempted_at)與 daily_log_revisions(edited_at)都曾經被寫成
 * created_at,cron 每天安靜地失敗好幾個月才被發現。
 */
const EXPECTED_TIME_COLUMNS: Record<string, string> = {
  login_attempts: "attempted_at",
  daily_log_revisions: "edited_at",
  audit_logs: "changed_at",
  app_messages: "created_at",
};

type Call = { table: string; col: string; cutoff: string; match?: Record<string, boolean> };

function makeStubClient(calls: Call[], failTable?: string) {
  return {
    from(table: string) {
      return {
        delete() {
          const call: Call = { table, col: "", cutoff: "" };
          calls.push(call);
          const q = {
            lt(col: string, cutoff: string) {
              call.col = col;
              call.cutoff = cutoff;
              return q;
            },
            match(m: Record<string, boolean>) {
              call.match = m;
              return q;
            },
            then(resolve: (v: { error: { message: string } | null; count: number | null }) => void) {
              resolve(
                table === failTable
                  ? { error: { message: `column ${table}.${call.col} does not exist` }, count: null }
                  : { error: null, count: 3 },
              );
            },
          };
          return q;
        },
      };
    },
  } as unknown as Parameters<typeof cleanupOldLogs>[0];
}

describe("cleanupOldLogs", () => {
  it("每張表都用 schema 裡真正存在的時間欄位", async () => {
    const calls: Call[] = [];
    await cleanupOldLogs(makeStubClient(calls));
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(EXPECTED_TIME_COLUMNS[c.table], `未知的表 ${c.table}`).toBeDefined();
      expect(c.col, `${c.table} 的時間欄位`).toBe(EXPECTED_TIME_COLUMNS[c.table]);
    }
    // 五張表 / 條件都有掃到
    const tables = calls.map((c) => c.table).sort();
    expect(tables).toEqual(
      ["app_messages", "audit_logs", "daily_log_revisions", "login_attempts", "login_attempts"].sort(),
    );
  });

  it("cutoff 依 RETENTION_DAYS 往回推,login_attempts 成功 / 失敗分開", async () => {
    const calls: Call[] = [];
    const before = Date.now();
    await cleanupOldLogs(makeStubClient(calls));
    const rev = calls.find((c) => c.table === "daily_log_revisions")!;
    const ageDays = (before - new Date(rev.cutoff).getTime()) / 86_400_000;
    expect(Math.round(ageDays)).toBe(RETENTION_DAYS.daily_log_revisions);

    const attempts = calls.filter((c) => c.table === "login_attempts");
    expect(attempts.map((c) => c.match)).toEqual(
      expect.arrayContaining([{ success: false }, { success: true }]),
    );
  });

  it("一張表失敗不影響其他表,結果帶回錯誤訊息", async () => {
    const calls: Call[] = [];
    const results = await cleanupOldLogs(makeStubClient(calls, "daily_log_revisions"));
    const failed = results.filter((r) => r.error !== null);
    expect(failed.map((r) => r.table)).toEqual(["daily_log_revisions"]);
    expect(failed[0].deleted).toBeNull();
    expect(results.filter((r) => r.error === null).every((r) => r.deleted === 3)).toBe(true);
  });
});
