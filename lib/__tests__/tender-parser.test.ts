import { describe, expect, it } from "vitest";
import { flattenTree, parseTenderHeader, parseTenderMatrix } from "@/lib/tender-parser";

/**
 * 標單 parser 的分類規則測試(decisions.md Phase 1 §2.2):
 *   有項次 + 無單位/數量 → section
 *   有項次 + 有單位/數量 → item
 *   無項次 + 有單位/數量 → spec(掛在上一個 item 下)
 *   無項次 + 無單位     → skip(小計、空白、表頭)
 *
 * 欄位順序:A=項次 B=名稱 C=單位 D=數量 E=單價 F=複價 G=廠牌
 */

const HEADER_ROW = ["項次", "項目名稱", "單位", "數量", "單價", "複價", "廠牌"];

function buildMatrix(rows: unknown[][]): unknown[][] {
  return [["某某工程 詳細價目表"], HEADER_ROW, ...rows];
}

describe("parseTenderMatrix — 分類規則", () => {
  const matrix = buildMatrix([
    ["壹", "機電工程", "", "", "", "", ""],
    ["壹.一", "EMT管 E19", "M", 100, 50, 5000, ""],
    ["", "EMT管 E25", "M", 40, 60, 2400, ""],
    ["", "小計", "", "", "", 7400, ""],
    ["", "", "", "", "", "", ""],
    ["壹.二", "給排水衛生設備工程", "", "", "", "", ""],
    ["壹.二.1", "泵浦", "台", 2, 30000, 60000, "廠牌A"],
  ]);
  const result = parseTenderMatrix(matrix);

  it("有項次無單位 → section(不論深度)", () => {
    const sections = result.rows.filter((r) => r.type === "section");
    expect(sections.map((s) => s.tenderCode)).toEqual(["壹", "壹.二"]);
  });

  it("有項次有單位數量 → item,數值正確", () => {
    const items = result.rows.filter((r) => r.type === "item");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      tenderCode: "壹.一",
      name: "EMT管 E19",
      unit: "M",
      quantity: 100,
      unitPrice: 50,
      totalPrice: 5000,
    });
    expect(items[1]?.brandNote).toBe("廠牌A");
  });

  it("無項次有單位數量 → spec(掛在上一個 item)", () => {
    const specs = result.rows.filter((r) => r.type === "spec");
    expect(specs).toHaveLength(1);
    expect(specs[0]?.name).toBe("EMT管 E25");
  });

  it("小計 / 空白行 / 表頭前標題 → skip", () => {
    const skipped = result.rows.filter((r) => r.type === "skip");
    // 標題列 + 表頭列 + 小計 + 空白行 = 4
    expect(skipped).toHaveLength(4);
  });

  it("stats 與分類一致", () => {
    expect(result.stats).toMatchObject({ sections: 2, items: 2, specs: 1 });
  });

  it("樹狀:spec 掛在 item 下,flattenTree 保持 DFS 順序", () => {
    const flat = flattenTree(result.tree);
    const names = flat.map((n) => n.name);
    const idxItem = names.indexOf("EMT管 E19");
    const idxSpec = names.indexOf("EMT管 E25");
    expect(idxItem).toBeGreaterThanOrEqual(0);
    expect(idxSpec).toBe(idxItem + 1);
    const spec = flat[idxSpec];
    const item = flat[idxItem];
    expect(spec?.parentId).toBe(item?.id);
    expect((spec?.depth ?? 0) > (item?.depth ?? 0)).toBe(true);
  });

  it("千分位字串數量可解析(『1,200』→ 1200)", () => {
    const r2 = parseTenderMatrix(
      buildMatrix([["壹.一", "電線", "M", "1,200", "10", "12,000", ""]]),
    );
    const item = r2.rows.find((r) => r.type === "item");
    expect(item?.quantity).toBe(1200);
    expect(item?.totalPrice).toBe(12000);
  });
});

describe("parseTenderHeader — 表頭欄位擷取", () => {
  it("公家工程格式:工程名稱 / 施工地點 / 工程編號", () => {
    const header = parseTenderHeader([
      ["OO市OO路管線汰換工程"],
      ["工程名稱", "OO市OO路管線汰換工程", "", "", "工程編號", "A-113-001"],
      ["施工地點", "OO市OO區", "", "", "", ""],
      HEADER_ROW,
    ]);
    expect(header.name).toBe("OO市OO路管線汰換工程");
    expect(header.location).toBe("OO市OO區");
    expect(header.code).toBe("A-113-001");
  });

  it("報價單格式:工地名稱 / 工程地點 / 客戶名稱", () => {
    const header = parseTenderHeader([
      ["裕民工務 - 報 價 單"],
      ["工地名稱", "某透天新建案", "", "", "", ""],
      ["工程地點", "台南市", "", "", "", ""],
      ["客戶名稱", "王先生", "", "", "", ""],
      HEADER_ROW,
    ]);
    expect(header.name).toBe("某透天新建案");
    expect(header.location).toBe("台南市");
    expect(header.client).toBe("王先生");
  });
});
