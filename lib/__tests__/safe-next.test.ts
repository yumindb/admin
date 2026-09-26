import { describe, expect, it } from "vitest";
import { safeNextPath } from "../auth/safe-next";

describe("safeNextPath(登入後導向只准站內)", () => {
  it("一般站內路徑照原樣保留(含 query / hash)", () => {
    expect(safeNextPath("/logs")).toBe("/logs");
    expect(safeNextPath("/logs/new?case=abc&x=1")).toBe("/logs/new?case=abc&x=1");
    expect(safeNextPath("/approvals#top")).toBe("/approvals#top");
  });

  it("外站與各種繞法一律回首頁", () => {
    for (const bad of [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/%5Cevil.com/..",
      "/\t/evil.com",
      "\\\\evil.com",
      "javascript:alert(1)",
      "",
    ]) {
      const out = safeNextPath(bad);
      expect(out.startsWith("/") && !out.startsWith("//"), `${JSON.stringify(bad)} → ${out}`).toBe(true);
      expect(new URL(out, "https://yumin-admin.vercel.app").origin).toBe("https://yumin-admin.vercel.app");
    }
    expect(safeNextPath("/\\evil.com")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
