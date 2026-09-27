import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/server";
import {
  PROXY_ACTIVE_STATUSES,
  PROXY_GRACE_DAYS,
  PROXY_LOOKAHEAD_DAYS,
  formatProxyFiller,
  leaveDateRange,
  windowCoversDate,
  type ProxyDelegation,
} from "@/lib/leave-proxy";

/**
 * 請假代理人(migration-2.43)— server 端讀取。
 *
 * 一律 service role,原因:
 *   - profiles 的 RLS 只讓主任 / 現場人員讀自己那列 — 假單上的申請人、代理人、
 *     簽核人名字,主任那邊本來就讀不到(2026-09-27 發現請假頁主任看到的申請人是「—」)
 *   - 代理人讀不到別人的假單(RLS),也不該讀到假別、事由 → 這裡只挑期間與主任姓名
 *
 * 全部吞錯回空值:migration-2.43 還沒跑(欄位不存在)時代理功能自然不出現,
 * 不能因為這裡讓 layout 或請假頁整頁壞掉。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

type LeaveRow = {
  id: string;
  applicant_id: string;
  start_at: string;
  end_at: string;
  status: string;
};

function admin() {
  try {
    return createServiceClient();
  } catch (e) {
    console.error("[proxy] service client 無法建立:", (e as Error).message);
    return null;
  }
}

/** 一批 profile id → 姓名(只給名字,給 RLS 讀不到別人 profile 的角色用) */
export async function loadProfileNames(
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return names;
  const supabase = admin();
  if (!supabase) return names;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", unique);
  if (error) {
    console.error("[proxy] 讀姓名失敗:", error.message);
    return names;
  }
  for (const p of data ?? []) {
    names.set(p.id as string, (p.full_name as string | null) ?? "未命名");
  }
  return names;
}

/** 可以被指定為代理人的人:啟用中的現場人員(依姓名排序) */
export async function loadProxyCandidates(): Promise<{ id: string; name: string }[]> {
  const supabase = admin();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "field_assistant")
    .eq("is_active", true)
    .order("full_name");
  if (error) {
    console.error("[proxy] 讀代理人名單失敗:", error.message);
    return [];
  }
  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: (p.full_name as string | null) ?? "未命名",
  }));
}

/**
 * 代理人功能能不能用 = migration-2.43 的代理判斷 function 在不在。
 * 不能只看 proxy_id 欄位:2.43 還原後欄位還在、policy 已拿掉 —
 * 這時還讓主任指定代理人,代理人每次存日誌都會被資料庫擋。
 */
export const isProxyFeatureReady = cache(async function isProxyFeatureReady(): Promise<boolean> {
  const supabase = admin();
  if (!supabase) return false;
  const { error } = await supabase.rpc("has_proxy_duty");
  return !error;
});

/** 假單列 → 代理任務;申請人現在不是工地主任的丟掉(跟資料庫 is_log_proxy 同規則) */
async function toDelegations(rows: LeaveRow[]): Promise<ProxyDelegation[]> {
  if (rows.length === 0) return [];
  const supabase = admin();
  if (!supabase) return [];
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .in("id", [...new Set(rows.map((r) => r.applicant_id))]);
  const byId = new Map(
    (people ?? []).map((p) => [
      p.id as string,
      { name: (p.full_name as string | null) ?? "主任", role: p.role as string },
    ]),
  );
  const out: ProxyDelegation[] = [];
  for (const r of rows) {
    const sup = byId.get(r.applicant_id);
    if (!sup || sup.role !== "site_supervisor") continue;
    out.push({
      leaveId: r.id,
      supervisorId: r.applicant_id,
      supervisorName: sup.name,
      status: r.status as ProxyDelegation["status"],
      ...leaveDateRange(r.start_at, r.end_at),
    });
  }
  return out;
}

/**
 * 我被指定為代理人、還用得到的代理任務(進行中含寬限 + 快開始的)。
 * 包 cache():layout 與頁面同一個 request 只查一次。
 * 回來之後用 splitDelegations() 依今天分組。
 */
export const loadMyDelegations = cache(async function loadMyDelegations(
  userId: string,
): Promise<ProxyDelegation[]> {
  const supabase = admin();
  if (!supabase) return [];
  const now = Date.now();
  const { data, error } = await supabase
    .from("leave_requests")
    .select("id, applicant_id, start_at, end_at, status")
    .eq("proxy_id", userId)
    .in("status", [...PROXY_ACTIVE_STATUSES])
    .gte("end_at", new Date(now - (PROXY_GRACE_DAYS + 1) * DAY_MS).toISOString())
    .lte("start_at", new Date(now + (PROXY_LOOKAHEAD_DAYS + 1) * DAY_MS).toISOString())
    .order("start_at")
    .limit(20);
  if (error) {
    // 欄位不存在 = migration-2.43 還沒跑,安靜略過;其他錯誤留 log
    if (!/proxy_id/.test(error.message)) {
      console.error("[proxy] 讀代理任務失敗:", error.message);
    }
    return [];
  }
  return toDelegations((data ?? []) as LeaveRow[]);
});

/**
 * 「proxyId 替 supervisorId 代理、涵蓋 date」的假單(簽核中 / 已核准);沒有回 null。
 * saveLogAction、日誌編輯頁驗證用 — 不看今天,只看日期在不在請假期間
 * (退回的代理日誌過幾天才改好重送也要能送)。
 */
export async function findDelegation(
  proxyId: string,
  supervisorId: string,
  date: string,
): Promise<ProxyDelegation | null> {
  const supabase = admin();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("leave_requests")
    .select("id, applicant_id, start_at, end_at, status")
    .eq("proxy_id", proxyId)
    .eq("applicant_id", supervisorId)
    .in("status", [...PROXY_ACTIVE_STATUSES])
    .order("start_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[proxy] 查代理假單失敗:", error.message);
    return null;
  }
  const list = await toDelegations((data ?? []) as LeaveRow[]);
  return list.find((d) => windowCoversDate(d, date)) ?? null;
}

/**
 * 清單上的填表人:代理日誌改寫成「王小明（代理 陳主任）」。
 * 直接改 profiles.full_name(待審核 / 待核定 / 加簽清單都讀這欄),清單元件不用動;
 * 本頁沒有代理日誌時不多查。
 */
export async function labelProxyFillers<
  T extends {
    proxy_for?: string | null;
    profiles: { full_name: string | null } | null;
  },
>(rows: T[]): Promise<T[]> {
  const ids = rows.map((r) => r.proxy_for).filter((x): x is string => !!x);
  if (ids.length === 0) return rows;
  const names = await loadProfileNames(ids);
  return rows.map((r) =>
    r.proxy_for
      ? {
          ...r,
          profiles: {
            ...r.profiles,
            full_name: formatProxyFiller(
              r.profiles?.full_name ?? "代理人",
              names.get(r.proxy_for) ?? "主任",
            ),
          },
        }
      : r,
  );
}
