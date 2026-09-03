import { describe, it, expect } from "vitest";
import {
  ERROR_DIGEST,
  classifyError,
  isRedactedServerMessage,
} from "../auth/error-codes";

/**
 * production 下 server 端錯誤的 message 會被 React 遮掉,只剩 digest —
 * 這組測試釘住「有 digest 就以 digest 為準、沒有才看 message」。
 */
const REDACTED =
  "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which may provide additional details about the nature of the error.";

describe("classifyError", () => {
  it("production:message 被遮掉,靠 digest 認出登入失效", () => {
    expect(classifyError({ message: REDACTED, digest: ERROR_DIGEST.authRequired })).toBe("auth");
  });

  it("production:digest 認出權限不足 / 暫時性錯誤", () => {
    expect(classifyError({ message: REDACTED, digest: ERROR_DIGEST.forbidden })).toBe("permission");
    expect(classifyError({ message: REDACTED, digest: ERROR_DIGEST.profileLoadFailed })).toBe("transient");
  });

  it("Next 自己算的 hash digest 不會被誤判,退回看 message", () => {
    expect(classifyError({ message: REDACTED, digest: "2301085382" })).toBe("generic");
    expect(classifyError({ message: "請先登入", digest: "2301085382" })).toBe("auth");
  });

  it("dev / client 端:沒有 digest 時沿用 message 字串判斷", () => {
    expect(classifyError({ message: "請先登入" })).toBe("auth");
    expect(classifyError({ message: "權限不足" })).toBe("permission");
    expect(classifyError({ message: "找不到這份日誌" })).toBe("notfound");
    expect(classifyError({ message: "boom" })).toBe("generic");
  });

  it("空值不炸", () => {
    expect(classifyError(null)).toBe("generic");
    expect(classifyError(undefined)).toBe("generic");
    expect(classifyError({})).toBe("generic");
  });
});

describe("isRedactedServerMessage", () => {
  it("認得 React 的樣板文", () => {
    expect(isRedactedServerMessage(REDACTED)).toBe(true);
    expect(isRedactedServerMessage("請先登入")).toBe(false);
    expect(isRedactedServerMessage(null)).toBe(false);
  });
});
