import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLineSignature } from "@/lib/line/client";
import { generateBindingCode, looksLikeBindingCode } from "@/lib/line/binding";
import { noticeFlex, textMessage } from "@/lib/line/flex";

describe("verifyLineSignature — webhook HMAC 驗證", () => {
  const secret = "test-channel-secret";
  const body = JSON.stringify({ events: [{ type: "follow" }] });
  const validSig = createHmac("sha256", secret).update(body).digest("base64");

  it("正確簽名 → true", () => {
    expect(verifyLineSignature(body, validSig, secret)).toBe(true);
  });

  it("錯誤簽名 → false", () => {
    const wrongSig = createHmac("sha256", "wrong-secret")
      .update(body)
      .digest("base64");
    expect(verifyLineSignature(body, wrongSig, secret)).toBe(false);
  });

  it("body 被竄改 → false", () => {
    expect(verifyLineSignature(body + "x", validSig, secret)).toBe(false);
  });

  it("缺 signature / 缺 secret → false(不能 throw)", () => {
    expect(verifyLineSignature(body, null, secret)).toBe(false);
    expect(verifyLineSignature(body, validSig, undefined)).toBe(false);
    expect(verifyLineSignature(body, "不是 base64 的東西!!", secret)).toBe(false);
  });
});

describe("generateBindingCode — 綁定碼", () => {
  it("固定 6 位數字(不足補零)", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateBindingCode()).toMatch(/^\d{6}$/);
    }
  });

  it("looksLikeBindingCode 容忍前後空白,擋非 6 位數", () => {
    expect(looksLikeBindingCode(" 123456 ")).toBe(true);
    expect(looksLikeBindingCode("12345")).toBe(false);
    expect(looksLikeBindingCode("1234567")).toBe(false);
    expect(looksLikeBindingCode("abc123")).toBe(false);
    expect(looksLikeBindingCode("解除綁定")).toBe(false);
  });
});

describe("Flex 模板", () => {
  it("textMessage 是合法 text message", () => {
    expect(textMessage("hi")).toEqual({ type: "text", text: "hi" });
  });

  it("noticeFlex:altText = 標題、摘要最多 5 行、按鈕連到系統網址", () => {
    const msg = noticeFlex({
      title: "新日誌待審核",
      lines: ["1", "2", "3", "4", "5", "6", "7"],
      tone: "amber",
      buttonLabel: "去審核",
      buttonPath: "/approvals",
    }) as {
      type: string;
      altText: string;
      contents: {
        body: { contents: unknown[] };
        footer: {
          contents: Array<{ action: { uri: string; label: string } }>;
        };
      };
    };
    expect(msg.type).toBe("flex");
    expect(msg.altText).toBe("新日誌待審核");
    // 標題 1 + 摘要最多 5 = 6
    expect(msg.contents.body.contents.length).toBe(6);
    const action = msg.contents.footer.contents[0].action;
    expect(action.label).toBe("去審核");
    expect(action.uri).toMatch(/^https:\/\/.+\/approvals$/);
  });
});
