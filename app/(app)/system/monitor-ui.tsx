import Link from "next/link";
import { MONITOR_DAY_OPTIONS } from "@/lib/monitor/shared";
import { ROLE_LABEL } from "@/lib/monitor/labels";
import type { Person } from "@/lib/monitor/queries";
import type { DailyBarDatum } from "./daily-bars";

/**
 * 系統監控四頁(常用操作 / 慢請求 / 錯誤紀錄 / 登入紀錄)共用的版面零件。
 * 只有 SYSTEM_ADMIN_USERNAMES 名單上的人看得到這些頁(lib/monitor/access.ts)。
 */

export type MonitorTab = "usage" | "slow" | "errors" | "logins";

const TABS: { key: MonitorTab; href: string; label: string }[] = [
  { key: "logins", href: "/reports/logins", label: "登入紀錄" },
  { key: "usage", href: "/system/usage", label: "常用操作" },
  { key: "slow", href: "/system/slow", label: "慢請求" },
  { key: "errors", href: "/system/errors", label: "錯誤紀錄" },
];

export function MonitorHeader({ active, subtitle }: { active: MonitorTab; subtitle: string }) {
  return (
    <div className="mb-6">
      <p className="text-sm tracking-widest text-[#A07850]">系統監控</p>
      <nav className="mt-2 flex flex-wrap gap-x-6 gap-y-2 border-b border-[#E0DCD6]" aria-label="系統監控">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === active ? "page" : undefined}
            className={`-mb-px border-b-2 px-0.5 pb-2.5 text-base ${
              t.key === active
                ? "border-primary font-semibold text-primary"
                : "border-transparent text-muted-foreground hover:text-primary"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <p className="mt-3 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

type SearchParams = Record<string, string | string[] | undefined>;

export function parseDays(sp: SearchParams, fallback = 7): number {
  const n = Number(sp.days);
  return (MONITOR_DAY_OPTIONS as readonly number[]).includes(n) ? n : fallback;
}

/** 保留其他篩選條件,只換其中一個參數 */
export function hrefWith(basePath: string, sp: SearchParams, patch: Record<string, string | null>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string" && v) params.set(k, v);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  const s = params.toString();
  return s ? `${basePath}?${s}` : basePath;
}

export function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`rounded-full border px-3 py-1.5 text-sm ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-[#E0DCD6] bg-card text-muted-foreground hover:border-accent"
      }`}
    >
      {children}
    </Link>
  );
}

export function DayPills({ basePath, sp, days }: { basePath: string; sp: SearchParams; days: number }) {
  return (
    <>
      {MONITOR_DAY_OPTIONS.map((d) => (
        <Pill key={d} href={hrefWith(basePath, sp, { days: String(d) })} active={days === d}>
          {d === 1 ? "今天" : `近 ${d} 天`}
        </Pill>
      ))}
    </>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-[#E0DCD6] bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-primary">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function NotReadyNotice() {
  return (
    <div className="rounded-md border border-[#E0DCD6] bg-card p-6 text-sm text-[#5A5050]">
      <p className="font-semibold text-primary">監控資料表還沒建立</p>
      <p className="mt-2">
        請在 Supabase SQL Editor 執行 <span className="font-mono">docs/migration-2.39.sql</span>。
        執行完之後，從那一刻開始的頁面瀏覽、操作與錯誤才會被記錄下來。
      </p>
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-[#E0DCD6] bg-card p-6 text-sm text-muted-foreground">{children}</p>
  );
}

/** 320 → 「320 毫秒」、2400 → 「2.4 秒」 */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} 秒`;
  return `${(ms / 60_000).toFixed(1)} 分鐘`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("zh-TW");
}

export function personText(person: Person | undefined, fallbackId?: string | null): string {
  if (person) return person.name;
  return fallbackId ? "（已刪除的帳號）" : "—";
}

export function roleText(role: string | null | undefined): string {
  return role ? ROLE_LABEL[role] ?? role : "—";
}

/** RPC 只回有資料的日期 — 補齊中間沒資料的日子(值 = 0),趨勢圖才不會把兩天擠在一起 */
export function fillDays<T extends { day: string }>(
  rows: T[],
  days: number,
  toDatum: (row: T | undefined, day: string) => DailyBarDatum,
): DailyBarDatum[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: DailyBarDatum[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const day = d.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
    out.push(toDatum(byDay.get(day), day));
  }
  return out;
}
