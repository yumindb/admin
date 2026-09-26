/**
 * 瀏覽器端錯誤回報 → /api/monitor/client-error → error_logs。
 * 給 app/error.tsx、app/global-error.tsx、instrumentation-client.ts 用。
 *
 * 每次載入頁面最多回報 5 則、同一則訊息只報一次,避免某個 bug 在迴圈裡洗版。
 * 回報本身失敗一律忽略(使用者不該因為監控而看到任何異常)。
 */
import { isIgnorableClientError, isTransientClientError } from "./shared";

export type ClientErrorKind = "boundary" | "global" | "window" | "promise";

const MAX_REPORTS_PER_PAGE_LOAD = 5;
let reported = 0;
const seen = new Set<string>();

export function reportClientError(input: {
  kind: ClientErrorKind;
  message: string;
  stack?: string | null;
  digest?: string | null;
}): void {
  try {
    if (typeof window === "undefined") return;
    const message = (input.message || "").slice(0, 1000);
    if (isIgnorableClientError(message, input.stack)) return;
    const key = `${input.kind}|${message}`;
    if (seen.has(key) || reported >= MAX_REPORTS_PER_PAGE_LOAD) return;
    seen.add(key);
    reported += 1;

    const body = JSON.stringify({
      kind: input.kind,
      level: isTransientClientError(message) ? "warn" : "error",
      message,
      stack: input.stack?.slice(0, 4000) ?? null,
      digest: input.digest ?? null,
      path: window.location.pathname,
    });
    const url = "/api/monitor/client-error";
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      void fetch(url, {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // 回報失敗就算了
  }
}
