import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import { formatTW } from "@/lib/datetime";

export const dynamic = "force-dynamic";

/**
 * /reports/audit — 操作紀錄(僅 office_staff / owner)。
 *
 * 資料是 migration-2.19 / 2.24 的 audit_logs:trigger 自動記錄
 * 人員資料、工項財務欄位、追加合約的修改/刪除,以及施工日誌的刪除。
 * 這頁只是唯讀檢視 — 在此之前只能下 SQL 查。
 * SELECT RLS 已限 office_staff / owner,直接用一般 client。
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DAY_OPTIONS = [7, 30, 90] as const;

const TABLE_LABEL: Record<string, string> = {
  profiles: "人員資料",
  case_work_items: "工項",
  extra_contracts: "追加合約",
  daily_logs: "施工日誌",
};

const FIELD_LABEL: Record<string, string> = {
  role: "角色",
  is_active: "啟用狀態",
  full_name: "姓名",
  phone: "電話",
  company: "公司",
  unit_price: "單價",
  total_price: "複價",
  quantity: "數量",
  name: "名稱",
  quote_status: "報價狀態",
  contract_signed_at: "簽約時間",
  contract_note: "簽約備註",
  extra_contract_id: "所屬追加合約",
  bundle_price: "合約總價",
  signed_at: "簽約日",
  note: "備註",
};

const ROLE_LABEL: Record<string, string> = {
  owner: "老闆",
  office_staff: "辦公室助理",
  site_supervisor: "工地主任",
  field_assistant: "現場人員",
};

type AuditRow = {
  id: string;
  table_name: string;
  record_id: string;
  action: "update" | "delete";
  changed_at: string;
  changed_fields: string[] | null;
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown> | null;
  profiles: { full_name: string | null } | null;
};

/** jsonb 值 → 短字串。物件/陣列不展開(雜訊),布林/角色轉中文。 */
function fmtValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "（空）";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (field === "role" && typeof v === "string") return ROLE_LABEL[v] ?? v;
  if (field === "is_active") return v ? "啟用" : "停用";
  if (typeof v === "object") return "（複合內容）";
  const s = String(v);
  // timestamptz → 只留日期時間
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    return formatTW(s, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}

/** 從 before/after 撈這筆紀錄的「主體名稱」讓人認得出是哪一筆。 */
function recordName(row: AuditRow): string | null {
  const src = row.after_values ?? row.before_values;
  if (!src) return null;
  const name = src["full_name"] ?? src["name"] ?? src["log_date"];
  return typeof name === "string" ? name : null;
}

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role !== "office_staff" && actor.role !== "owner") redirect("/");

  const sp = await searchParams;
  const days = DAY_OPTIONS.includes(Number(sp.days) as (typeof DAY_OPTIONS)[number])
    ? Number(sp.days)
    : 30;
  const table = typeof sp.table === "string" && sp.table in TABLE_LABEL ? sp.table : "";

  const supabase = await createClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from("audit_logs")
    .select(
      "id, table_name, record_id, action, changed_at, changed_fields, before_values, after_values, profiles(full_name)",
    )
    .gte("changed_at", since)
    .order("changed_at", { ascending: false })
    .limit(200);
  if (table) query = query.eq("table_name", table);
  const { data, error } = await query;
  const rows = (data ?? []) as unknown as AuditRow[];

  const pillHref = (nextDays: number, nextTable: string) => {
    const params = new URLSearchParams();
    if (nextDays !== 30) params.set("days", String(nextDays));
    if (nextTable) params.set("table", nextTable);
    const s = params.toString();
    return s ? `/reports/audit?${s}` : "/reports/audit";
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-primary md:text-3xl">操作紀錄</h1>
        <p className="mt-1.5 text-base text-muted-foreground">
          人員資料、工項單價、追加合約的每一次修改與刪除都自動留底，保留一年、無法竄改
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {DAY_OPTIONS.map((d) => (
          <Link
            key={d}
            href={pillHref(d, table)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              days === d
                ? "border-primary bg-primary text-primary-foreground"
                : "border-[#E0DCD6] bg-card text-muted-foreground hover:border-accent"
            }`}
          >
            近 {d} 天
          </Link>
        ))}
        <span className="mx-1 h-5 w-px bg-[#E0DCD6]" />
        <Link
          href={pillHref(days, "")}
          className={`rounded-full border px-3 py-1.5 text-sm ${
            !table
              ? "border-primary bg-primary text-primary-foreground"
              : "border-[#E0DCD6] bg-card text-muted-foreground hover:border-accent"
          }`}
        >
          全部
        </Link>
        {Object.entries(TABLE_LABEL).map(([key, label]) => (
          <Link
            key={key}
            href={pillHref(days, key)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              table === key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-[#E0DCD6] bg-card text-muted-foreground hover:border-accent"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {error ? (
        <p className="rounded-md border border-[#E0DCD6] bg-card p-6 text-sm text-muted-foreground">
          讀取操作紀錄失敗：{error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-[#E0DCD6] bg-card p-6 text-sm text-muted-foreground">
          這段期間沒有操作紀錄 — 表示沒有人動過人員、單價或合約資料。
        </p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => {
            const name = recordName(r);
            const changed = (r.changed_fields ?? []).filter((f) => f !== "updated_at");
            return (
              <div key={r.id} className="rounded-lg border border-[#E0DCD6] bg-card p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {formatTW(r.changed_at, {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="font-medium text-primary">
                    {r.profiles?.full_name ?? "（系統）"}
                  </span>
                  {r.action === "delete" ? (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
                      刪除
                    </span>
                  ) : (
                    <span className="rounded-full bg-[#F5F1EC] px-2 py-0.5 text-xs text-[#A07850]">
                      修改
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {TABLE_LABEL[r.table_name] ?? r.table_name}
                    {name && <span className="ml-1 text-foreground">「{name}」</span>}
                  </span>
                </div>
                {r.action === "update" && changed.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
                    {changed.map((f) => (
                      <li key={f}>
                        <span className="text-foreground">{FIELD_LABEL[f] ?? f}</span>：
                        {fmtValue(f, r.before_values?.[f])}
                        <span className="mx-1 text-[#A07850]">→</span>
                        {fmtValue(f, r.after_values?.[f])}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {rows.length >= 200 && (
            <p className="px-1 py-1 text-xs text-muted-foreground">
              僅顯示最近 200 筆，縮短天數或按類別篩選可看得更精準。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
