/**
 * 系統監控頁的資料讀取(service role;呼叫前頁面一定要先過 requireSystemAdmin)。
 * 彙總一律在 DB 做(migration-2.39 的 monitor_* function)— PostgREST 單次最多 1000 筆,
 * 拉原始列回來算會默默少算。
 */
import { createServiceClient } from "@/lib/supabase/server";
import { emailToUsername } from "@/lib/auth/username";
import { fetchAllRows } from "@/lib/db/fetch-all";
import { startOfRecentDaysTaipei } from "@/lib/datetime";

export type RequestStat = {
  kind: "view" | "action";
  route: string;
  action_name: string | null;
  calls: number;
  users: number;
  errors: number;
  slow: number;
  cold: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  last_at: string;
};

export type UserStat = {
  user_id: string;
  views: number;
  actions: number;
  errors: number;
  last_at: string;
};

export type DailyCount = {
  day: string;
  views: number;
  actions: number;
  users: number;
  slow: number;
  errors: number;
};

export type ErrorGroup = {
  fingerprint: string;
  source: "server" | "db" | "client";
  level: "error" | "warn";
  message: string;
  route: string | null;
  occurrences: number;
  users: number;
  first_at: string;
  last_at: string;
  first_ever_at: string;
};

export type ErrorRow = {
  id: number;
  occurred_at: string;
  source: "server" | "db" | "client";
  level: "error" | "warn";
  fingerprint: string;
  message: string;
  detail: string | null;
  digest: string | null;
  stack: string | null;
  route: string | null;
  path: string | null;
  route_type: string | null;
  action_name: string | null;
  user_id: string | null;
  role: string | null;
  user_agent: string | null;
};

export type SlowRow = {
  id: number;
  occurred_at: string;
  user_id: string | null;
  role: string | null;
  kind: "page" | "nav" | "action";
  route: string;
  path: string | null;
  action_name: string | null;
  duration_ms: number;
  status: "ok" | "error";
  cold_start: boolean;
  device: string | null;
};

export type Person = {
  name: string;
  role: string | null;
  username: string | null;
  isActive: boolean;
};

export type OverallStats = {
  calls: number;
  users: number;
  slow: number;
  errors: number;
  cold: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
};

export type ErrorDaily = { day: string; errors: number; warns: number; users: number };

/** 表不存在 = migration-2.39 還沒跑 */
function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST205" ||
    error.code === "PGRST202" ||
    error.code === "42P01" ||
    error.code === "42883" ||
    /does not exist|Could not find/i.test(error.message ?? "")
  );
}

export class MonitorNotReadyError extends Error {}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 「近 N 天」= 今天(台灣時間 0 點起)往前共 N 天 — 跟每日趨勢圖的日期格對齊 */
export function sinceIso(days: number): string {
  return startOfRecentDaysTaipei(days).toISOString();
}

/** profile id → 姓名 / 角色 / 帳號(25 人左右,一次撈完) */
export async function loadPeople(): Promise<Map<string, Person>> {
  const admin = createServiceClient();
  const [{ data: profiles }, { data: users }] = await Promise.all([
    admin.from("profiles").select("id, full_name, role, is_active"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  const usernameById = new Map<string, string | null>();
  for (const u of users?.users ?? []) usernameById.set(u.id, emailToUsername(u.email));
  const map = new Map<string, Person>();
  for (const p of profiles ?? []) {
    const id = p.id as string;
    map.set(id, {
      name: (p.full_name as string | null) ?? usernameById.get(id) ?? "（未命名）",
      role: (p.role as string | null) ?? null,
      username: usernameById.get(id) ?? null,
      isActive: p.is_active !== false,
    });
  }
  return map;
}

export async function loadOverallStats(days: number, slowMs: number): Promise<OverallStats> {
  const { data, error } = await createServiceClient().rpc("monitor_overall_stats", {
    p_since: sinceIso(days),
    p_slow_ms: slowMs,
  });
  if (isMissingRelation(error)) throw new MonitorNotReadyError();
  if (error) throw new Error(`讀取整體統計失敗:${error.message}`);
  const r = ((data ?? []) as Record<string, unknown>[])[0] ?? {};
  return {
    calls: num(r.calls),
    users: num(r.users),
    slow: num(r.slow),
    errors: num(r.errors),
    cold: num(r.cold),
    p50_ms: num(r.p50_ms),
    p95_ms: num(r.p95_ms),
    max_ms: num(r.max_ms),
  };
}

export async function loadErrorDaily(days: number): Promise<ErrorDaily[]> {
  const { data, error } = await createServiceClient().rpc("monitor_error_daily", {
    p_since: sinceIso(days),
  });
  if (isMissingRelation(error)) throw new MonitorNotReadyError();
  if (error) throw new Error(`讀取每日錯誤數失敗:${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    day: String(r.day),
    errors: num(r.errors),
    warns: num(r.warns),
    users: num(r.users),
  }));
}

export async function loadRequestStats(days: number, slowMs: number): Promise<RequestStat[]> {
  const { data, error } = await createServiceClient().rpc("monitor_request_stats", {
    p_since: sinceIso(days),
    p_slow_ms: slowMs,
  });
  if (isMissingRelation(error)) throw new MonitorNotReadyError();
  if (error) throw new Error(`讀取請求統計失敗:${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    kind: r.kind === "action" ? "action" : "view",
    route: String(r.route ?? ""),
    action_name: (r.action_name as string | null) ?? null,
    calls: num(r.calls),
    users: num(r.users),
    errors: num(r.errors),
    slow: num(r.slow),
    cold: num(r.cold),
    avg_ms: num(r.avg_ms),
    p50_ms: num(r.p50_ms),
    p95_ms: num(r.p95_ms),
    max_ms: num(r.max_ms),
    last_at: String(r.last_at ?? ""),
  }));
}

export async function loadUserStats(days: number): Promise<UserStat[]> {
  const { data, error } = await createServiceClient().rpc("monitor_user_stats", {
    p_since: sinceIso(days),
  });
  if (isMissingRelation(error)) throw new MonitorNotReadyError();
  if (error) throw new Error(`讀取使用者統計失敗:${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    user_id: String(r.user_id),
    views: num(r.views),
    actions: num(r.actions),
    errors: num(r.errors),
    last_at: String(r.last_at ?? ""),
  }));
}

export async function loadDailyCounts(days: number, slowMs: number): Promise<DailyCount[]> {
  const { data, error } = await createServiceClient().rpc("monitor_daily_counts", {
    p_since: sinceIso(days),
    p_slow_ms: slowMs,
  });
  if (isMissingRelation(error)) throw new MonitorNotReadyError();
  if (error) throw new Error(`讀取每日趨勢失敗:${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    day: String(r.day),
    views: num(r.views),
    actions: num(r.actions),
    users: num(r.users),
    slow: num(r.slow),
    errors: num(r.errors),
  }));
}

/** 各帳號在期間內「成功登入」次數(login_attempts 只有 email) */
export async function loadLoginCounts(days: number): Promise<Map<string, number>> {
  const admin = createServiceClient();
  const { data } = await fetchAllRows<{ email: string }>((from, to) =>
    admin
      .from("login_attempts")
      .select("email")
      .eq("success", true)
      .gte("attempted_at", sinceIso(days))
      .order("attempted_at", { ascending: false })
      .range(from, to),
  );
  const counts = new Map<string, number>();
  for (const row of data) {
    const username = emailToUsername(row.email)?.toLowerCase();
    if (username) counts.set(username, (counts.get(username) ?? 0) + 1);
  }
  return counts;
}

export async function loadSlowRequests(days: number, slowMs: number, limit = 100): Promise<SlowRow[]> {
  const { data, error } = await createServiceClient()
    .from("request_logs")
    .select("id, occurred_at, user_id, role, kind, route, path, action_name, duration_ms, status, cold_start, device")
    .gte("occurred_at", sinceIso(days))
    .gte("duration_ms", slowMs)
    .order("duration_ms", { ascending: false })
    .limit(limit);
  if (isMissingRelation(error)) throw new MonitorNotReadyError();
  if (error) throw new Error(`讀取慢請求失敗:${error.message}`);
  return (data ?? []) as SlowRow[];
}

export async function loadErrorGroups(days: number): Promise<ErrorGroup[]> {
  const { data, error } = await createServiceClient().rpc("monitor_error_groups", {
    p_since: sinceIso(days),
  });
  if (isMissingRelation(error)) throw new MonitorNotReadyError();
  if (error) throw new Error(`讀取錯誤分組失敗:${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    fingerprint: String(r.fingerprint),
    source: (r.source as ErrorGroup["source"]) ?? "server",
    level: r.level === "warn" ? "warn" : "error",
    message: String(r.message ?? ""),
    route: (r.route as string | null) ?? null,
    occurrences: num(r.occurrences),
    users: num(r.users),
    first_at: String(r.first_at ?? ""),
    last_at: String(r.last_at ?? ""),
    first_ever_at: String(r.first_ever_at ?? ""),
  }));
}

/** 最近的錯誤明細(每組展開時顯示最近幾筆) */
export async function loadRecentErrors(days: number, limit = 500): Promise<ErrorRow[]> {
  const { data, error } = await createServiceClient()
    .from("error_logs")
    .select(
      "id, occurred_at, source, level, fingerprint, message, detail, digest, stack, route, path, route_type, action_name, user_id, role, user_agent",
    )
    .gte("occurred_at", sinceIso(days))
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (isMissingRelation(error)) throw new MonitorNotReadyError();
  if (error) throw new Error(`讀取錯誤明細失敗:${error.message}`);
  return (data ?? []) as ErrorRow[];
}
