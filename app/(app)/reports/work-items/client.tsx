"use client";

/**
 * 跨案工項報表 client side:
 *   - 案件多選(checkbox 群組)
 *   - 工項名稱搜尋(string includes,大小寫不敏感)
 *   - 進度區間 radio:全部 / <50% / 50-99% / =100% / >100%
 *   - 「下載 Excel」按鈕(把選中的 case ids 傳給 server action)
 */
import { useMemo, useState } from "react";
import { ExcelDownloadButton } from "@/components/excel-download-button";
import { getCrossCaseSummaryXlsxAction } from "../reports-actions";
import type { CrossCaseSummaryRow } from "@/lib/excel/cross-case-summary";

type CaseLite = {
  id: string;
  name: string;
  code: string | null;
  company: string;
};

type PctRange = "all" | "lt50" | "50-99" | "eq100" | "gt100";

const PCT_OPTIONS: { key: PctRange; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "lt50", label: "<50%" },
  { key: "50-99", label: "50-99%" },
  { key: "eq100", label: "=100%" },
  { key: "gt100", label: ">100%" },
];

export function WorkItemsReportClient({
  rows,
  cases,
}: {
  rows: CrossCaseSummaryRow[];
  cases: CaseLite[];
}) {
  const [selectedCases, setSelectedCases] = useState<Set<string>>(
    () => new Set(cases.map((c) => c.id)),
  );
  const [search, setSearch] = useState("");
  const [pctRange, setPctRange] = useState<PctRange>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!selectedCases.has(r.caseId)) return false;
      if (q) {
        const hay = `${r.workItemName} ${r.workItemCode ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      const pct = r.donePct;
      switch (pctRange) {
        case "lt50":
          if (pct === null || pct >= 50) return false;
          break;
        case "50-99":
          if (pct === null || pct < 50 || pct >= 100) return false;
          break;
        case "eq100":
          if (pct === null || Math.round(pct) !== 100) return false;
          break;
        case "gt100":
          if (pct === null || pct <= 100) return false;
          break;
        case "all":
        default:
          break;
      }
      return true;
    });
  }, [rows, selectedCases, search, pctRange]);

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

  return (
    <>
      {/* 篩選區 */}
      <div className="mb-5 space-y-3 rounded-lg border border-[#E0DCD6] bg-card p-4 md:p-5">
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
          <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
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
                    {c.company || "—"}
                  </span>
                  <span>{c.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 搜尋 + 進度 */}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col">
            <span className="mb-1 text-sm font-medium text-primary">
              工項名稱
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="輸入關鍵字(EMT、PVC、E19…)"
              className="h-10 rounded-md border border-[#E0DCD6] bg-white px-3 text-sm focus:border-accent focus:outline-none"
            />
          </label>
          <div>
            <div className="mb-1 text-sm font-medium text-primary">完成 %</div>
            <div className="flex flex-wrap gap-1.5">
              {PCT_OPTIONS.map((o) => {
                const active = o.key === pctRange;
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setPctRange(o.key)}
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
      </div>

      {/* 操作列 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          共 {filtered.length} 筆 / {rows.length} 筆
        </div>
        <ExcelDownloadButton
          label="下載 Excel"
          size="lg"
          variant="outline"
          onFetch={() =>
            getCrossCaseSummaryXlsxAction(Array.from(selectedCases))
          }
        />
      </div>

      {/* 表格 */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          沒有符合條件的工項
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#E0DCD6] bg-card">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                <Th>公司</Th>
                <Th>案件</Th>
                <Th>編碼</Th>
                <Th>工項</Th>
                <Th>單位</Th>
                <Th align="right">契約量</Th>
                <Th align="right">累計完成</Th>
                <Th align="right">完成 %</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const overshoot = r.donePct !== null && r.donePct > 100;
                return (
                  <tr
                    key={`${r.caseId}-${r.workItemId}`}
                    className="border-b border-[#E0DCD6]"
                  >
                    <Td>{r.caseCompany || "—"}</Td>
                    <Td>{r.caseName}</Td>
                    <Td>{r.workItemCode ?? "—"}</Td>
                    <Td>{r.workItemName}</Td>
                    <Td>{r.workItemUnit ?? "—"}</Td>
                    <Td align="right">
                      {r.contractQty !== null ? r.contractQty : "—"}
                    </Td>
                    <Td align="right">{r.doneQty}</Td>
                    <Td align="right">
                      {r.donePct === null ? (
                        "—"
                      ) : (
                        <span className={overshoot ? "text-[#B91C1C]" : ""}>
                          {r.donePct}%
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
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

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      className={`h-11 px-3 align-middle ${
        align === "right" ? "text-right tabular-nums" : ""
      }`}
    >
      {children}
    </td>
  );
}
