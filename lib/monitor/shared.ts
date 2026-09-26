/**
 * 系統監控(登入紀錄 / 常用操作 / 慢請求 / 錯誤紀錄)共用的常數與純函式。
 *
 * ⚠ 這個檔案會被 proxy.ts、client component、instrumentation-client.ts 一起 import,
 * 不能碰 next/headers、supabase server client、Node 專屬 API。
 *
 * 資料流(細節見 docs/PROJECT.md「系統監控」節):
 *   proxy.ts 在每個已登入的 request 貼上 x-ym-* header(起始時間、request id、user id)
 *   → getActor()/tryGetActor() 第一次被呼叫時(lib/auth/require-role.ts)用 after()
 *     在回應送完後寫一筆 request_logs(耗時 = 現在 − proxy 起始時間)
 *   → 伺服器錯誤走 instrumentation.ts 的 onRequestError、DB 錯誤走 wrapDbError、
 *     瀏覽器錯誤走 /api/monitor/client-error,都寫進 error_logs
 */

/** proxy 注入、下游讀取的 request header。client 送來的同名 header 會在 proxy 被清掉。 */
export const MONITOR_HEADERS = {
  /** proxy 收到 request 的時間(epoch ms) */
  start: "x-ym-t0",
  /** 這個 request 的 id(串 request_logs 與 error_logs) */
  requestId: "x-ym-rid",
  /** proxy 驗過 JWT 的 user id(只拿來做紀錄歸屬,不做授權) */
  userId: "x-ym-uid",
  /** 實際路徑(不含 query) */
  path: "x-ym-path",
} as const;

export const MONITOR_HEADER_PREFIX = "x-ym-";

/** 「慢」的門檻。頁面伺服器端處理超過這個毫秒數就算慢請求(頁面上可切換)。 */
export const SLOW_THRESHOLD_OPTIONS = [1000, 2000, 5000] as const;
export const DEFAULT_SLOW_MS = 2000;

/** 監控頁的時間範圍選項(天) */
export const MONITOR_DAY_OPTIONS = [1, 7, 30, 90] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 實際路徑 → 路由樣板。/logs/9f1c…-…/edit → /logs/[id]/edit。
 * 本系統所有動態段都是 UUID(案件、日誌、回報、假單),純數字也一併收斂,
 * 避免同一頁因為不同 id 被拆成幾百列。
 */
export function normalizeRoute(pathname: string | null | undefined): string {
  if (!pathname) return "/";
  const clean = pathname.split("?")[0].split("#")[0];
  const segments = clean
    .split("/")
    .filter(Boolean)
    .map((s) => (UUID_RE.test(s) || /^\d+$/.test(s) ? "[id]" : s));
  const route = "/" + segments.join("/");
  return route.length > 200 ? route.slice(0, 200) : route;
}

/** 從 User-Agent 猜裝置 — 純 heuristic,認不出就「其他」。登入紀錄與請求紀錄共用。 */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "—";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows 電腦";
  if (/Macintosh/i.test(ua)) return "Mac";
  return "其他";
}

/**
 * 把錯誤訊息裡會變的部分(id、數字、時間)換掉,讓「同一種錯誤」歸成一組。
 * 例:「找不到日誌 9f1c…」與「找不到日誌 77aa…」→ 同一組。
 */
export function normalizeErrorMessage(message: string | null | undefined): string {
  return (message ?? "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, "<time>")
    .replace(/\d{3,}/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** 錯誤分組鍵(server 端再 hash 成短字串存進 error_logs.fingerprint) */
export function errorGroupKey(source: string, message: string, route: string | null): string {
  return `${source}|${normalizeErrorMessage(message)}|${route ?? ""}`;
}

/**
 * 瀏覽器端的雜訊錯誤 — 回報了也無法處理,直接丟掉。
 * (網路斷線、chunk 載入失敗不算雜訊:工地訊號差、部署後舊頁面都是真實狀況,只是降為 warn)
 */
export function isIgnorableClientError(message: string, stack?: string | null): boolean {
  const m = message.trim();
  if (!m) return true;
  if (/^Script error\.?$/i.test(m)) return true; // 跨網域腳本,沒有任何資訊
  if (/ResizeObserver loop/i.test(m)) return true; // 瀏覽器排版警告,無害
  if (/(chrome|moz|safari(-web)?)-extension:\/\//i.test(`${m}\n${stack ?? ""}`)) return true; // 瀏覽器外掛
  if (/^AbortError|The (operation|user) (was )?abort/i.test(m)) return true; // 使用者自己取消 / 換頁
  return false;
}

/** 網路類 / 部署後舊版 chunk — 真實但通常重試就好,記成 warn */
export function isTransientClientError(message: string): boolean {
  return /Failed to fetch|Load failed|NetworkError|network error|ChunkLoadError|Loading chunk .* failed|Failed to load chunk|dynamically imported module/i.test(
    message,
  );
}
