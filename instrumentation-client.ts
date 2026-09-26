/**
 * 瀏覽器端:沒被 error boundary 接住的錯誤(事件處理、setTimeout、Promise)回報到錯誤紀錄。
 * 在 React hydrate 之前執行 — 保持輕量,只掛兩個 listener。
 */
import { reportClientError } from "@/lib/monitor/client";

try {
  window.addEventListener("error", (event) => {
    const err = event.error as Error | undefined;
    reportClientError({
      kind: "window",
      message: err?.message || event.message || "",
      stack: err?.stack ?? (event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : null),
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { message?: string; stack?: string } | string | undefined;
    reportClientError({
      kind: "promise",
      message: typeof reason === "string" ? reason : reason?.message || String(reason ?? ""),
      stack: typeof reason === "object" ? reason?.stack ?? null : null,
    });
  });
} catch {
  // 監控掛不上不影響使用
}
