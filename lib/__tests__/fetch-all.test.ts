import { describe, expect, it } from "vitest";
import { fetchAllRows } from "@/lib/db/fetch-all";

/** 模擬 PostgREST:一個 N 列的表,range(from,to) 回傳切片。 */
function fakeTable(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }));
  const calls: Array<[number, number]> = [];
  const queryPage = (from: number, to: number) => {
    calls.push([from, to]);
    return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
  };
  return { queryPage, calls };
}

describe("fetchAllRows — 突破 1000 筆截斷", () => {
  it("少於一頁:一次拿完", async () => {
    const t = fakeTable(42);
    const r = await fetchAllRows(t.queryPage);
    expect(r.data).toHaveLength(42);
    expect(r.error).toBeNull();
    expect(t.calls).toHaveLength(1);
  });

  it("剛好整頁邊界(1000):會多拿一次空頁確認結束", async () => {
    const t = fakeTable(1000);
    const r = await fetchAllRows(t.queryPage);
    expect(r.data).toHaveLength(1000);
    expect(t.calls).toHaveLength(2);
  });

  it("跨頁(2500):完整取回,不重複不漏列", async () => {
    const t = fakeTable(2500);
    const r = await fetchAllRows(t.queryPage);
    expect(r.data).toHaveLength(2500);
    expect(new Set(r.data.map((x) => x.id)).size).toBe(2500);
    expect(t.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("query 出錯:回傳 error + 已取得的部分", async () => {
    let call = 0;
    const r = await fetchAllRows<{ id: number }>((from, to) => {
      call++;
      if (call === 2) return Promise.resolve({ data: null, error: { message: "boom" } });
      return Promise.resolve({
        data: Array.from({ length: 1000 }, (_, i) => ({ id: from + i })),
        error: null,
      });
    });
    expect(r.error?.message).toBe("boom");
    expect(r.data).toHaveLength(1000);
  });
});
