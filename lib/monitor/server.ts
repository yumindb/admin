/**
 * 系統監控 — server 端記錄(request_logs / error_logs,migration-2.39)。
 *
 * 設計重點:
 *   - **不增加使用者等待時間**:一律用 after() 在回應送完之後才寫 DB
 *   - **記錄失敗絕不影響正常功能**:所有進入點都吞掉自己的錯誤;表還沒建(migration 沒跑)也只是靜默略過
 *   - 只記「經過 proxy、已登入」的請求(proxy 貼了 x-ym-t0 才算);公開頁、cron 不記,
 *     prefetch 只跑到 loading 邊界、執行不到 createClient,也不會被記
 *
 * 進入點:
 *   trackRequest()      — lib/supabase/server.ts 的 createClient() 每次都呼叫;同一個 request 只登記一次
 *   annotateRequest()   — getActor() 拿到角色後補上
 *   recordServerError() — instrumentation.ts 的 onRequestError
 *   reportDbError()     — lib/db/wrap-error.ts 的 wrapDbError
 *   insertErrorLog()    — /api/monitor/client-error(瀏覽器回報)
 */
import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { after } from "next/server";
import {
  MONITOR_HEADERS,
  deviceLabel,
  errorGroupKey,
  normalizeRoute,
  requestKind,
  type RequestKind,
} from "./shared";

type Trace = {
  requestId: string;
  startedAt: number;
  kind: RequestKind;
  path: string;
  route: string;
  actionId: string | null;
  userId: string | null;
  role: string | null;
  device: string;
  coldStart: boolean;
};

type ErrorSource = "server" | "db" | "client";

export type ErrorLogInput = {
  source: ErrorSource;
  level?: "error" | "warn";
  message: string;
  detail?: string | null;
  digest?: string | null;
  stack?: string | null;
  path?: string | null;
  routeType?: string | null;
  actionName?: string | null;
  requestId?: string | null;
  userId?: string | null;
  role?: string | null;
  userAgent?: string | null;
};

/**
 * 跨 bundle 共用的狀態放 globalThis:instrumentation.ts 與各路由的 chunk
 * 可能各有一份這個模組,module-level 變數不保證共用。
 */
type MonitorGlobal = {
  traces: WeakMap<object, Trace>;
  errored: Map<string, number>;
  warm: boolean;
  missingTableWarned: boolean;
};
const G = globalThis as typeof globalThis & { __ymMonitor?: MonitorGlobal };
function state(): MonitorGlobal {
  if (!G.__ymMonitor) {
    G.__ymMonitor = {
      traces: new WeakMap(),
      errored: new Map(),
      warm: false,
      missingTableWarned: false,
    };
  }
  return G.__ymMonitor;
}

/** 長字串截斷(DB 欄位沒設上限,這裡控制單筆大小) */
function clip(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function isUuid(value: string | null | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * server action 的 id → export 名稱。
 * Next 16 把 server-reference manifest(含 exportedName)放在 globalThis 的
 * Symbol.for("next.server.manifests");這是內部結構,拿不到就退回 id 前綴,
 * 監控頁會顯示成「未知操作」但統計照樣正確。
 */
export function resolveActionName(actionId: string | null | undefined): string | null {
  if (!actionId) return null;
  try {
    const singleton = (globalThis as Record<symbol, unknown>)[Symbol.for("next.server.manifests")] as
      | { serverActionsManifest?: { node?: Record<string, { exportedName?: string }> } }
      | undefined;
    const name = singleton?.serverActionsManifest?.node?.[actionId]?.exportedName;
    if (name) return name;
  } catch {
    // 內部結構改了 — 退回 id
  }
  return `#${actionId.slice(0, 10)}`;
}

/**
 * 本機 next dev 連的也是正式資料庫:開發時的編譯時間(動輒 5~30 秒)會把慢請求頁灌爆,
 * 測試時故意弄出來的錯誤也會混進錯誤紀錄,所以預設不寫。要在本機測監控功能時設 MONITOR_IN_DEV=1。
 */
function writeEnabled(): boolean {
  return process.env.NODE_ENV === "production" || process.env.MONITOR_IN_DEV === "1";
}

async function insertRow(table: "request_logs" | "error_logs", row: Record<string, unknown>) {
  if (!writeEnabled()) return;
  try {
    const { createServiceClient } = await import("@/lib/supabase/server");
    const { error } = await createServiceClient().from(table).insert(row);
    if (error) {
      const s = state();
      // migration-2.39 還沒跑:表不存在,只提示一次,不要洗版
      if (error.code === "PGRST205" || error.code === "42P01") {
        if (!s.missingTableWarned) {
          s.missingTableWarned = true;
          console.warn(`[monitor] ${table} 不存在(migration-2.39 尚未執行),監控紀錄暫停`);
        }
        return;
      }
      console.error(`[monitor] 寫入 ${table} 失敗: ${error.message}`);
    }
  } catch (e) {
    console.error(`[monitor] 寫入 ${table} 例外:`, e instanceof Error ? e.message : e);
  }
}

/**
 * 登記這個 request:回應送完後寫一筆 request_logs。
 * 同一個 request 呼叫幾次都只登記一次(以 headers 物件當 key)。
 */
export async function trackRequest(): Promise<void> {
  try {
    const h = await headers();
    const s = state();
    if (s.traces.has(h)) return;

    const t0 = Number(h.get(MONITOR_HEADERS.start));
    if (!Number.isFinite(t0) || t0 <= 0) return; // 沒經過 proxy 的已登入流程(公開頁、cron、after 裡的背景工作)
    const kind = requestKind((name) => h.get(name));
    const path = h.get(MONITOR_HEADERS.path) ?? "/";
    if (path.startsWith("/api/")) return;

    const now = Date.now();
    // proxy 與頁面可能在不同機器上跑,時鐘差異通常只有幾毫秒;離譜的就改用本機時間
    const startedAt = t0 <= now && now - t0 < 10 * 60_000 ? t0 : now;
    const coldStart = !s.warm;
    s.warm = true;

    const rid = h.get(MONITOR_HEADERS.requestId);
    const uid = h.get(MONITOR_HEADERS.userId);
    const trace: Trace = {
      requestId: isUuid(rid) ? rid : randomUUID(),
      startedAt,
      kind,
      path: path.slice(0, 300),
      route: normalizeRoute(path),
      actionId: kind === "action" ? h.get("next-action") : null,
      userId: isUuid(uid) ? uid : null,
      role: null,
      device: deviceLabel(h.get("user-agent")),
      coldStart,
    };
    s.traces.set(h, trace);

    after(async () => {
      const durationMs = Math.max(0, Date.now() - trace.startedAt);
      const errored = s.errored.has(trace.requestId);
      s.errored.delete(trace.requestId);
      await insertRow("request_logs", {
        request_id: trace.requestId,
        user_id: trace.userId,
        role: trace.role,
        kind: trace.kind,
        route: trace.route,
        path: trace.path,
        action_name: trace.kind === "action" ? resolveActionName(trace.actionId) : null,
        duration_ms: Math.min(durationMs, 2_147_483_647),
        status: errored ? "error" : "ok",
        cold_start: trace.coldStart,
        device: trace.device,
      });
    });
  } catch {
    // headers() / after() 只能在 request 裡呼叫(測試、build 期、背景工作都會走到這)— 不記就好
  }
}

/** getActor() 拿到角色後補進這個 request 的紀錄(after 執行時才讀,所以晚補也來得及) */
export async function annotateRequest(info: { userId: string; role: string }): Promise<void> {
  try {
    const h = await headers();
    const trace = state().traces.get(h);
    if (!trace) return;
    trace.role = info.role;
    if (!trace.userId) trace.userId = info.userId;
  } catch {
    // 不在 request 裡 — 略過
  }
}

function markErrored(requestId: string | null | undefined) {
  if (!isUuid(requestId)) return;
  const s = state();
  s.errored.set(requestId, Date.now());
  // 萬一 after() 沒跑(極少數),避免 Map 無限長大
  if (s.errored.size > 500) {
    const cutoff = Date.now() - 5 * 60_000;
    for (const [id, at] of s.errored) if (at < cutoff) s.errored.delete(id);
  }
}

export async function insertErrorLog(input: ErrorLogInput): Promise<void> {
  const route = input.path ? normalizeRoute(input.path) : null;
  const message = clip(input.message.trim() || "(沒有訊息的錯誤)", 1000)!;
  const fingerprint = createHash("sha1")
    .update(errorGroupKey(input.source, message, route))
    .digest("hex")
    .slice(0, 16);
  await insertRow("error_logs", {
    source: input.source,
    level: input.level ?? "error",
    fingerprint,
    message,
    detail: clip(input.detail, 2000),
    digest: clip(input.digest, 100),
    stack: clip(input.stack, 4000),
    route,
    path: clip(input.path?.split("?")[0], 300),
    route_type: clip(input.routeType, 40),
    action_name: clip(input.actionName, 100),
    request_id: isUuid(input.requestId) ? input.requestId : null,
    user_id: isUuid(input.userId) ? input.userId : null,
    role: clip(input.role, 40),
    user_agent: clip(input.userAgent, 300),
  });
}

/** 已由 wrapDbError 記過的錯誤:onRequestError 看到就不重複記 */
const LOGGED_MARK = "__ymLogged";

export function markLogged(err: Error): void {
  try {
    Object.defineProperty(err, LOGGED_MARK, { value: true, enumerable: false });
  } catch {
    // frozen error — 最多重複記一筆,無妨
  }
}

function isMarkedLogged(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as Record<string, unknown>)[LOGGED_MARK] === true;
}

/** 這幾個 digest 是「預期中」的狀況(登入過期、權限不足),記成 warn 方便過濾 */
const WARN_DIGESTS = new Set(["AUTH_REQUIRED", "FORBIDDEN"]);

type OnRequestErrorRequest = {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
};
type OnRequestErrorContext = {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
  renderSource?: string;
};

function headerValue(h: OnRequestErrorRequest["headers"], name: string): string | null {
  const v = h[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function describeCause(err: unknown): string | null {
  const cause = err && typeof err === "object" ? (err as { cause?: unknown }).cause : null;
  if (!cause) return null;
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "object") {
    const c = cause as { message?: string; code?: string; details?: string; hint?: string };
    return [c.message, c.code && `code=${c.code}`, c.details, c.hint].filter(Boolean).join(" | ") || null;
  }
  return String(cause);
}

/** instrumentation.ts onRequestError → 這裡 */
export async function recordServerError(
  err: unknown,
  request: OnRequestErrorRequest,
  context: OnRequestErrorContext,
): Promise<void> {
  try {
    const rid = headerValue(request.headers, MONITOR_HEADERS.requestId);
    markErrored(rid);
    if (isMarkedLogged(err)) return;

    const e = err as (Error & { digest?: string }) | null;
    const digest = e?.digest ?? null;
    const actionId = headerValue(request.headers, "next-action");
    await insertErrorLog({
      source: "server",
      level: digest && WARN_DIGESTS.has(digest) ? "warn" : "error",
      message: e?.message || String(err),
      detail: [describeCause(err), context.routePath && `route file: ${context.routePath}`, context.renderSource]
        .filter(Boolean)
        .join("\n") || null,
      digest,
      stack: e?.stack ?? null,
      path: headerValue(request.headers, MONITOR_HEADERS.path) ?? request.path,
      routeType: context.routeType ?? null,
      actionName: actionId ? resolveActionName(actionId) : null,
      requestId: rid,
      userId: headerValue(request.headers, MONITOR_HEADERS.userId),
      userAgent: headerValue(request.headers, "user-agent"),
    });
  } catch {
    // 記錄失敗不能影響 Next 原本的錯誤處理
  }
}

function describeDbError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: string; code?: string; details?: string; hint?: string };
    return [e.message, e.code && `code=${e.code}`, e.details, e.hint].filter(Boolean).join(" | ") || "未知的資料庫錯誤";
  }
  return String(err);
}

/**
 * wrapDbError 呼叫:把「資料庫實際回的錯誤」記下來(畫面上使用者只看到中文的「儲存失敗」)。
 * 在 server action / route handler 裡 after() 可以讀 headers 拿到是誰、哪一頁;
 * 在 Server Component 裡讀不到就只記錯誤本身。
 */
export function reportDbError(err: unknown, userMessage: string): void {
  const dbMessage = describeDbError(err);
  try {
    after(async () => {
      let ctx: Partial<ErrorLogInput> = {};
      try {
        const h = await headers();
        const trace = state().traces.get(h);
        ctx = {
          path: h.get(MONITOR_HEADERS.path),
          requestId: h.get(MONITOR_HEADERS.requestId),
          userId: trace?.userId ?? h.get(MONITOR_HEADERS.userId),
          role: trace?.role ?? null,
          actionName: h.get("next-action") ? resolveActionName(h.get("next-action")) : null,
          routeType: h.get("next-action") ? "action" : "render",
          userAgent: h.get("user-agent"),
        };
      } catch {
        // Server Component 的 after() 不能讀 headers — 只記錯誤內容
      }
      await insertErrorLog({
        ...ctx,
        source: "db",
        level: "error",
        message: `${userMessage}:${dbMessage}`,
        detail: dbMessage,
      });
    });
  } catch {
    // 不在 request 裡(測試 / script)— console.error 已經印過了
  }
}
