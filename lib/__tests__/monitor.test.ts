import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  errorGroupKey,
  isIgnorableClientError,
  isTransientClientError,
  normalizeErrorMessage,
  normalizeRoute,
  requestKind,
} from "../monitor/shared";
import { ACTION_LABELS, ROUTE_LABELS } from "../monitor/labels";
import { startOfMonthTaipei, startOfRecentDaysTaipei, startOfTodayTaipei } from "../datetime";
import { isSystemAdmin } from "../monitor/access";

const ROOT = join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("normalizeRoute", () => {
  it("UUID 與純數字段收斂成 [id],去掉 query", () => {
    expect(normalizeRoute("/logs/9f1c2a3b-1111-4222-8333-444455556666/edit?x=1")).toBe("/logs/[id]/edit");
    expect(normalizeRoute("/cases/123")).toBe("/cases/[id]");
    expect(normalizeRoute("/")).toBe("/");
    expect(normalizeRoute("")).toBe("/");
    expect(normalizeRoute("/reports/work-items")).toBe("/reports/work-items");
  });
});

describe("requestKind", () => {
  const kind = (h: Record<string, string>) => requestKind((name) => h[name] ?? null);

  it("有 next-action 就是按鈕操作", () => {
    expect(kind({ "next-action": "7f3a9c", "sec-fetch-mode": "cors", accept: "text/x-component" })).toBe("action");
  });

  it("Sec-Fetch-Mode: navigate 是開頁面,前端 fetch 是站內換頁", () => {
    expect(kind({ "sec-fetch-mode": "navigate", accept: "text/html,application/xhtml+xml,*/*;q=0.8" })).toBe("page");
    expect(kind({ "sec-fetch-mode": "cors", accept: "*/*" })).toBe("nav");
    expect(kind({ "sec-fetch-mode": "same-origin", accept: "*/*" })).toBe("nav");
  });

  it("舊版 Safari 沒有 Sec-Fetch-*:改看 Accept", () => {
    expect(kind({ accept: "text/html,application/xhtml+xml,*/*;q=0.8" })).toBe("page");
    expect(kind({ accept: "*/*" })).toBe("nav");
  });
});

describe("錯誤分組", () => {
  it("訊息裡的 id、數字、時間不影響分組", () => {
    const a = normalizeErrorMessage("找不到日誌 9f1c2a3b-1111-4222-8333-444455556666(第 1234 筆)");
    const b = normalizeErrorMessage("找不到日誌 77aa2a3b-1111-4222-8333-444455556666(第 98765 筆)");
    expect(a).toBe(b);
    expect(errorGroupKey("server", "x 2026-09-26T01:02:03.456Z", "/logs")).toBe(
      errorGroupKey("server", "x 2026-01-01T00:00:00Z", "/logs"),
    );
  });

  it("瀏覽器雜訊直接丟掉,網路 / chunk 錯誤降為 warn", () => {
    expect(isIgnorableClientError("Script error.")).toBe(true);
    expect(isIgnorableClientError("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
    expect(isIgnorableClientError("x", "at chrome-extension://abc/content.js:1:1")).toBe(true);
    expect(isIgnorableClientError("Cannot read properties of undefined (reading 'map')")).toBe(false);
    expect(isTransientClientError("TypeError: Failed to fetch")).toBe(true);
    expect(isTransientClientError("ChunkLoadError: Loading chunk 123 failed.")).toBe(true);
    expect(isTransientClientError("Cannot read properties of undefined")).toBe(false);
  });
});

describe("中文標籤覆蓋", () => {
  it("app/(app) 底下每一頁都有 ROUTE_LABELS", () => {
    const pages = walk(join(ROOT, "app", "(app)")).filter((f) => f.endsWith(`${sep}page.tsx`));
    const missing: string[] = [];
    for (const file of pages) {
      const rel = relative(join(ROOT, "app", "(app)"), file).split(sep);
      rel.pop(); // page.tsx
      const route = "/" + rel.filter((s) => !(s.startsWith("(") && s.endsWith(")"))).join("/");
      if (!ROUTE_LABELS[route]) missing.push(route);
    }
    expect(missing, "請在 lib/monitor/labels.ts 的 ROUTE_LABELS 補上").toEqual([]);
  });

  it("每個 server action 都有 ACTION_LABELS", () => {
    const files = walk(join(ROOT, "app")).filter((f) => /\.tsx?$/.test(f));
    const missing: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (!/^['"]use server['"]/m.test(src)) continue;
      for (const m of src.matchAll(/^export (?:async function|const) (\w+)/gm)) {
        if (!ACTION_LABELS[m[1]]) missing.push(`${relative(ROOT, file)}:${m[1]}`);
      }
    }
    expect(missing, "請在 lib/monitor/labels.ts 的 ACTION_LABELS 補上").toEqual([]);
  });
});

describe("台灣時區日界", () => {
  it("UTC 23:30 已經是台灣隔天 07:30 — 今天從台灣 00:00 算", () => {
    const now = new Date("2026-09-25T23:30:00Z"); // 台灣 09-26 07:30
    expect(startOfTodayTaipei(now).toISOString()).toBe("2026-09-25T16:00:00.000Z");
  });

  it("月初:UTC 9/30 20:00 = 台灣 10/1 04:00,本月從 10/1 00:00 算", () => {
    const now = new Date("2026-09-30T20:00:00Z");
    expect(startOfMonthTaipei(now).toISOString()).toBe("2026-09-30T16:00:00.000Z");
  });

  it("近 7 天 = 今天往前共 7 個台灣日", () => {
    const now = new Date("2026-09-26T03:00:00Z"); // 台灣 09-26 11:00
    expect(startOfRecentDaysTaipei(7, now).toISOString()).toBe("2026-09-19T16:00:00.000Z");
    expect(startOfRecentDaysTaipei(1, now).toISOString()).toBe("2026-09-25T16:00:00.000Z");
  });
});

describe("isSystemAdmin", () => {
  const original = process.env.SYSTEM_ADMIN_USERNAMES;
  afterEach(() => {
    process.env.SYSTEM_ADMIN_USERNAMES = original;
  });

  it("只認名單上的帳號,沒設定就沒人看得到", () => {
    process.env.SYSTEM_ADMIN_USERNAMES = "";
    expect(isSystemAdmin({ email: "evelyn@yumin.local" })).toBe(false);
    process.env.SYSTEM_ADMIN_USERNAMES = " Evelyn , other ";
    expect(isSystemAdmin({ email: "evelyn@yumin.local" })).toBe(true);
    expect(isSystemAdmin({ email: "owner@yumin.local" })).toBe(false);
    expect(isSystemAdmin({ email: null })).toBe(false);
    expect(isSystemAdmin(null)).toBe(false);
  });
});
