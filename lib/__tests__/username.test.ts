import { describe, expect, it } from "vitest";
import {
  USERNAME_SUFFIX,
  emailToUsername,
  usernameSchema,
  usernameToEmail,
} from "@/lib/auth/username";

describe("usernameSchema — 帳號格式", () => {
  it("小寫字母 + 數字 2-30 字合法", () => {
    expect(usernameSchema.safeParse("owner").success).toBe(true);
    expect(usernameSchema.safeParse("a1").success).toBe(true);
  });

  it("大寫與前後空白會被正規化成合法帳號", () => {
    const parsed = usernameSchema.safeParse("  Owner01 ");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe("owner01");
  });

  it("太短 / 特殊字元 / 中文不合法", () => {
    expect(usernameSchema.safeParse("a").success).toBe(false);
    expect(usernameSchema.safeParse("user_name").success).toBe(false);
    expect(usernameSchema.safeParse("王小明").success).toBe(false);
    expect(usernameSchema.safeParse("a".repeat(31)).success).toBe(false);
  });
});

describe("usernameToEmail / emailToUsername — 雙向轉換", () => {
  it("帳號 → 內部 email(固定 @yumin.local 後綴)", () => {
    expect(usernameToEmail("owner")).toBe(`owner${USERNAME_SUFFIX}`);
    expect(usernameToEmail(" Owner ")).toBe(`owner${USERNAME_SUFFIX}`);
  });

  it("內部 email → 顯示用帳號", () => {
    expect(emailToUsername(`super1${USERNAME_SUFFIX}`)).toBe("super1");
  });

  it("非 @yumin.local 的真 email 原樣回傳(不遺失資訊)", () => {
    expect(emailToUsername("phil@example.com")).toBe("phil@example.com");
  });

  it("null / undefined / 空字串 → null", () => {
    expect(emailToUsername(null)).toBeNull();
    expect(emailToUsername(undefined)).toBeNull();
    expect(emailToUsername("")).toBeNull();
  });

  it("round-trip:帳號 → email → 帳號 不變", () => {
    expect(emailToUsername(usernameToEmail("worker9"))).toBe("worker9");
  });
});
