"use client";

/**
 * /reports/cases-overview 客戶端表格元件:支援排序。
 *
 * 沒有篩選 — 由 caller server side 已經依角色 filter 過。
 * 視欄位需求,可額外加 status filter,但 POC 階段先不擠太多 UI。
 */
import Link from "next/link";
import { useState } from "react";
import { formatDateTW } from "@/lib/datetime";
import type { CaseStatus } from "@/lib/types";

export type CaseOverviewRow = {
  caseId: string;
  caseName: string;
  caseCode: string | null;
  company: string;
  status: CaseStatus;
  startedAt: string | null;
  progressPct: number | null;
  logCount: number;
  behind: boolean;
};

type SortKey = "name" | "progress" | "started" | "logs" | "behind";

const STATUS_LABEL: Record<CaseStatus, { label: string; cls: string }> = {
  active: { label: "進行中", cls: "bg-[#ECFDF5] text-[#4A7C59] border-[#A7F3D0]" },
  paused: { label: "暫停", cls: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]" },
  closed: { label: "結案", cls: "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]" },
};

export function CasesOverviewReportClient({
  rows,
}: {
  rows: CaseOverviewRow[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("progress");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function setSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "behind" ? "desc" : "asc");
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "name":
        return a.caseName.localeCompare(b.caseName, "zh-Hant") * dir;
      case "progress": {
        const av = a.progressPct ?? -1;
        const bv = b.progressPct ?? -1;
        return (av - bv) * dir;
      }
      case "started": {
        const av = a.startedAt ?? "";
        const bv = b.startedAt ?? "";
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return av.localeCompare(bv) * dir;
      }
      case "logs":
        return (a.logCount - b.logCount) * dir;
      case "behind":
        return ((a.behind ? 1 : 0) - (b.behind ? 1 : 0)) * dir;
      default:
        return 0;
    }
  });

  const behindCount = rows.filter((r) => r.behind).length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          共 {rows.length} 個案件
          {behindCount > 0 && (
            <span className="ml-3 rounded-full border border-[#FCA5A5] bg-[#FEF2F2] px-2 py-0.5 text-xs text-[#B91C1C]">
              落後 {behindCount}
            </span>
          )}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#E0DCD6] bg-card">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-primary text-primary-foreground">
              <SortHeader
                label="案件"
                k="name"
                cur={sortKey}
                dir={sortDir}
                onClick={setSort}
              />
              <Th>公司</Th>
              <Th>狀態</Th>
              <SortHeader
                label="開工日"
                k="started"
                cur={sortKey}
                dir={sortDir}
                onClick={setSort}
              />
              <SortHeader
                label="進度"
                k="progress"
                cur={sortKey}
                dir={sortDir}
                onClick={setSort}
                align="right"
              />
              <SortHeader
                label="累計日誌"
                k="logs"
                cur={sortKey}
                dir={sortDir}
                onClick={setSort}
                align="right"
              />
              <SortHeader
                label="落後"
                k="behind"
                cur={sortKey}
                dir={sortDir}
                onClick={setSort}
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const s = STATUS_LABEL[r.status];
              return (
                <tr key={r.caseId} className="border-b border-[#E0DCD6]">
                  <td className="h-12 px-3">
                    <Link
                      href={`/cases/${r.caseId}`}
                      className="font-medium text-primary underline-offset-2 hover:text-accent hover:underline"
                    >
                      {r.caseName}
                    </Link>
                    {r.caseCode && (
                      <div className="text-[11px] text-muted-foreground">
                        {r.caseCode}
                      </div>
                    )}
                  </td>
                  <Td>{r.company || "—"}</Td>
                  <Td>
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${s.cls}`}
                    >
                      {s.label}
                    </span>
                  </Td>
                  <Td>{r.startedAt ? formatDateTW(r.startedAt) : "—"}</Td>
                  <Td align="right">
                    {r.progressPct === null ? "—" : `${r.progressPct}%`}
                  </Td>
                  <Td align="right">{r.logCount}</Td>
                  <Td>
                    {r.behind ? (
                      <span className="rounded-full border border-[#FCA5A5] bg-[#FEF2F2] px-2 py-0.5 text-[11px] text-[#B91C1C]">
                        落後
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`h-11 px-3 text-xs font-medium tracking-wider ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function SortHeader({
  label,
  k,
  cur,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  k: SortKey;
  cur: SortKey;
  dir: "asc" | "desc";
  onClick: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = cur === k;
  return (
    <th
      className={`h-11 px-3 text-xs font-medium tracking-wider ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        onClick={() => onClick(k)}
        className="inline-flex items-center gap-1 text-primary-foreground hover:opacity-80"
      >
        <span>{label}</span>
        {active && <span aria-hidden>{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      className={`h-12 px-3 align-middle ${
        align === "right" ? "text-right tabular-nums" : ""
      }`}
    >
      {children}
    </td>
  );
}
