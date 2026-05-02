"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ApprovalDecision, ApprovalStage } from "@/lib/types";

export type HistoryRow = {
  id: string;
  logId: string;
  stage: ApprovalStage;
  stageLabel: string;
  decision: ApprovalDecision;
  comment: string | null;
  createdAt: string;
  createdAtLabel: string;
  logDate: string; // YYYY-MM-DD
  logDateLabel: string;
  caseName: string;
  caseCode: string | null;
};

type DecisionFilter = "all" | "approved" | "rejected";

export function HistoryFilters({ rows }: { rows: HistoryRow[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [decision, setDecision] = useState<DecisionFilter>("all");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (decision !== "all" && r.decision !== decision) return false;
      // 用 logDate(該日誌的施工日期)做篩選
      if (from && r.logDate && r.logDate < from) return false;
      if (to && r.logDate && r.logDate > to) return false;
      return true;
    });
  }, [rows, from, to, decision]);

  function clearFilters() {
    setFrom("");
    setTo("");
    setDecision("all");
  }

  const hasFilters = from !== "" || to !== "" || decision !== "all";

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-[#E0DCD6] bg-card px-3 py-3 md:px-4">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          從
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 rounded-md border border-[#E0DCD6] bg-white px-2 text-sm text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          到
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 rounded-md border border-[#E0DCD6] bg-white px-2 text-sm text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
        </label>
        <div
          role="tablist"
          aria-label="通過 / 退回"
          className="inline-flex rounded-md border border-[#E0DCD6] bg-white p-0.5"
        >
          <ToggleBtn
            label="全部"
            active={decision === "all"}
            onClick={() => setDecision("all")}
          />
          <ToggleBtn
            label="通過"
            active={decision === "approved"}
            tone="success"
            onClick={() => setDecision("approved")}
          />
          <ToggleBtn
            label="退回"
            active={decision === "rejected"}
            tone="danger"
            onClick={() => setDecision("rejected")}
          />
        </div>
        <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
          <span>顯示 {filtered.length} / {rows.length} 筆</span>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-accent hover:underline"
            >
              清除篩選
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          沒有符合篩選條件的紀錄
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-[#E0DCD6] bg-card p-4 transition-colors hover:border-accent md:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{r.caseCode ?? "未編號"}</span>
                    <span aria-hidden>·</span>
                    <span>{r.logDateLabel}</span>
                    <span aria-hidden>·</span>
                    <span>{r.stageLabel}</span>
                  </div>
                  <h3 className="break-words text-base font-semibold text-primary md:text-lg">
                    {r.caseName}
                  </h3>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      r.decision === "approved"
                        ? "border-[#A7F3D0] bg-[#ECFDF5] text-[#4A7C59]"
                        : "border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]"
                    }`}
                  >
                    {r.decision === "approved" ? "通過" : "退回"}
                  </span>
                </div>
              </div>
              {r.comment && (
                <p className="mt-2 whitespace-pre-line rounded-md border border-[#E0DCD6] bg-[#FAF7F2] px-3 py-2 text-sm text-foreground">
                  {r.comment}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>簽核時間:{r.createdAtLabel}</span>
                <Link
                  href={`/logs/${r.logId}`}
                  className="text-accent hover:underline"
                >
                  看日誌 →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ToggleBtn({
  label,
  active,
  tone,
  onClick,
}: {
  label: string;
  active: boolean;
  tone?: "success" | "danger";
  onClick: () => void;
}) {
  let activeCls = "bg-primary text-primary-foreground";
  if (active && tone === "success") activeCls = "bg-[#4A7C59] text-white";
  if (active && tone === "danger") activeCls = "bg-[#B91C1C] text-white";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-[5px] px-3 py-1 text-sm transition-colors ${
        active
          ? activeCls
          : "text-muted-foreground hover:bg-[#F5F1EC] hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
