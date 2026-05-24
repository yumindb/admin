"use client";

/**
 * 未簽約 / 超工項目報表(client filter)。
 *
 * 篩選:
 *   - 日期區間(from / to)
 *   - 案件多選
 *   - 類型(全部 / 合約外 / 未簽約 / 點工 / 變更追加)
 *   - period=month 預設把 from/to 設為本月
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatDateTW } from "@/lib/datetime";
import { getCompanyShort } from "@/lib/companies";

export type UnsignedRow = {
  kind: "extra" | "unsigned";
  logId: string;
  logDate: string;
  caseId: string;
  caseName: string;
  caseCompany: string;
  supervisorName: string;
  name: string;
  unit: string | null;
  qty: number | null;
  headcount: number | null;
  location: string | null;
  requestedBy: string | null;
  category: string | null;       // 點工 / 變更追加（只有 kind=unsigned 才有）
  quoteAmount: number | null;
  reason: string | null;
};

type CaseLite = {
  id: string;
  name: string;
  code: string | null;
  company: string;
};

type KindFilter = "all" | "extra" | "unsigned" | "點工" | "變更追加";

const KIND_OPTIONS: { key: KindFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "extra", label: "合約外" },
  { key: "unsigned", label: "未簽約" },
  { key: "點工", label: "點工" },
  { key: "變更追加", label: "變更追加" },
];

function getMonthRange(): { from: string; to: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(new Date()); // YYYY-MM-DD
  const [y, m] = today.split("-");
  const from = `${y}-${m}-01`;
  return { from, to: today };
}

export function UnsignedReportClient({
  rows,
  cases,
  initialPeriod,
}: {
  rows: UnsignedRow[];
  cases: CaseLite[];
  initialPeriod: "all" | "month";
}) {
  const initRange = initialPeriod === "month" ? getMonthRange() : null;
  const [from, setFrom] = useState<string>(initRange?.from ?? "");
  const [to, setTo] = useState<string>(initRange?.to ?? "");
  const [selectedCases, setSelectedCases] = useState<Set<string>>(
    () => new Set(cases.map((c) => c.id)),
  );
  const [kind, setKind] = useState<KindFilter>("all");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (from && r.logDate < from) return false;
      if (to && r.logDate > to) return false;
      if (!selectedCases.has(r.caseId)) return false;
      switch (kind) {
        case "extra":
          if (r.kind !== "extra") return false;
          break;
        case "unsigned":
          if (r.kind !== "unsigned") return false;
          break;
        case "點工":
          if (r.kind !== "unsigned" || r.category !== "點工") return false;
          break;
        case "變更追加":
          if (r.kind !== "unsigned" || r.category !== "變更追加") return false;
          break;
        case "all":
        default:
          break;
      }
      return true;
    });
  }, [rows, from, to, selectedCases, kind]);

  function toggleCase(id: string) {
    setSelectedCases((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedCases(new Set(cases.map((c) => c.id)));
  }
  function selectNone() {
    setSelectedCases(new Set());
  }

  const totalQuote = filtered.reduce(
    (sum, r) => sum + (r.quoteAmount ?? 0),
    0,
  );

  return (
    <>
      {/* 篩選 */}
      <div className="mb-5 space-y-3 rounded-lg border border-[#E0DCD6] bg-card p-4 md:p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="flex flex-col">
            <span className="mb-1 text-sm font-medium text-primary">起</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-10 rounded-md border border-[#E0DCD6] bg-white px-3 text-sm focus:border-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-sm font-medium text-primary">迄</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-10 rounded-md border border-[#E0DCD6] bg-white px-3 text-sm focus:border-accent focus:outline-none"
            />
          </label>
          <div>
            <div className="mb-1 text-sm font-medium text-primary">類型</div>
            <div className="flex flex-wrap gap-1.5">
              {KIND_OPTIONS.map((o) => {
                const active = o.key === kind;
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setKind(o.key)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-[#E0DCD6] bg-white text-foreground hover:border-accent"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 案件多選 */}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-primary">案件</span>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={selectAll}
                className="text-accent underline-offset-2 hover:underline"
              >
                全選
              </button>
              <span className="text-muted-foreground">·</span>
              <button
                type="button"
                onClick={selectNone}
                className="text-accent underline-offset-2 hover:underline"
              >
                清除
              </button>
            </div>
          </div>
          {cases.length === 0 ? (
            <span className="text-xs text-muted-foreground">沒有相關案件</span>
          ) : (
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-[#E0DCD6] bg-[#FAF7F2] p-2">
              {cases.map((c) => {
                const active = selectedCases.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCase(c.id)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-[#E0DCD6] bg-white text-foreground hover:border-accent"
                    }`}
                  >
                    <span className="rounded bg-white/20 px-1 text-[10px]">
                      {c.company ? getCompanyShort(c.company) : "—"}
                    </span>
                    <span>{c.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 統計列 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          共 {filtered.length} 筆 / {rows.length} 筆
        </span>
        {totalQuote > 0 && (
          <span className="rounded-md border border-[#E0DCD6] bg-[#FAF7F2] px-3 py-1.5 text-foreground">
            報價金額合計：
            <span className="ml-1.5 font-semibold tabular-nums text-primary">
              ${totalQuote.toLocaleString("en-US")}
            </span>
          </span>
        )}
      </div>

      {/* 表格 */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          沒有符合條件的項目
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#E0DCD6] bg-card">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                <Th className="min-w-[5.5rem] whitespace-nowrap">日期</Th>
                <Th className="min-w-[3rem] whitespace-nowrap">公司</Th>
                <Th className="min-w-[8rem] break-keep">案件</Th>
                <Th className="min-w-[5rem] break-keep">工地主任</Th>
                <Th className="min-w-[4.5rem] whitespace-nowrap">類型</Th>
                <Th className="min-w-[8rem] break-keep">項目</Th>
                <Th align="right" className="min-w-[4rem] whitespace-nowrap">數量</Th>
                <Th align="right" className="min-w-[3.5rem] whitespace-nowrap">人數</Th>
                <Th align="right" className="min-w-[5rem] whitespace-nowrap">報價金額</Th>
                <Th className="min-w-[6rem] break-keep">事由 / 備註</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr
                  key={`${r.logId}-${r.kind}-${i}`}
                  className="border-b border-[#E0DCD6]"
                >
                  <Td>
                    <Link
                      href={`/logs/${r.logId}`}
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      {formatDateTW(r.logDate)}
                    </Link>
                  </Td>
                  <Td>
                    {r.caseCompany ? getCompanyShort(r.caseCompany) : "—"}
                  </Td>
                  <Td>
                    <Link
                      href={`/cases/${r.caseId}`}
                      className="block text-foreground hover:text-accent hover:underline underline-offset-2"
                    >
                      {r.caseName}
                    </Link>
                  </Td>
                  <Td>{r.supervisorName}</Td>
                  <Td>
                    {r.kind === "extra" ? (
                      <span className="rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 text-[11px] text-[#92400E]">
                        合約外
                      </span>
                    ) : (
                      <span className="rounded-full border border-[#FCA5A5] bg-[#FEF2F2] px-2 py-0.5 text-[11px] text-[#B91C1C]">
                        {r.category ? `未簽約·${r.category}` : "未簽約"}
                      </span>
                    )}
                  </Td>
                  <Td>{r.name || "—"}</Td>
                  <Td align="right">
                    {r.qty !== null ? (
                      <>
                        {r.qty}
                        {r.unit && <span className="ml-0.5 text-xs text-muted-foreground">{r.unit}</span>}
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td align="right">{r.headcount ?? "—"}</Td>
                  <Td align="right">
                    {r.quoteAmount !== null && r.quoteAmount > 0
                      ? `$${r.quoteAmount.toLocaleString("en-US")}`
                      : "—"}
                  </Td>
                  <Td>
                    {r.reason || r.location || r.requestedBy ? (
                      <div className="space-y-0.5 text-xs">
                        {r.reason && <div>{r.reason}</div>}
                        {r.location && (
                          <div className="text-muted-foreground">
                            位置:{r.location}
                          </div>
                        )}
                        {r.requestedBy && (
                          <div className="text-muted-foreground">
                            甲方交辦:{r.requestedBy}
                          </div>
                        )}
                      </div>
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Th({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={`h-11 px-3 text-xs font-medium tracking-wider ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={`h-11 px-3 align-top py-2 ${
        align === "right" ? "text-right tabular-nums" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}
