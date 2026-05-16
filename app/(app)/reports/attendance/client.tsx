"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  AttendanceTimeline,
  type TimelineEvent,
} from "@/components/attendance-timeline";
import { exportAttendanceXlsx } from "./actions";

export type CaseOpt = { id: string; label: string };
export type UserOpt = { id: string; label: string };
export type EventRow = TimelineEvent;

export function AttendanceReportClient({
  cases,
  users,
  initialFrom,
  initialTo,
  initialCaseId,
  initialUserId,
  rows,
}: {
  cases: CaseOpt[];
  users: UserOpt[];
  initialFrom: string;
  initialTo: string;
  initialCaseId: string;
  initialUserId: string;
  rows: EventRow[];
}) {
  const router = useRouter();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [caseId, setCaseId] = useState(initialCaseId);
  const [userId, setUserId] = useState(initialUserId);
  const [downloading, startDownload] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function applyFilter() {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (caseId) params.set("case", caseId);
    if (userId) params.set("user", userId);
    router.push(`/reports/attendance?${params.toString()}`);
  }

  function download() {
    setError(null);
    startDownload(async () => {
      const res = await exportAttendanceXlsx({
        from,
        to,
        caseId: caseId || null,
        userId: userId || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // base64 → Blob → a.download(避免靠 server return file 的 dynamic route)
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // 統計:超出範圍 / 在範圍 / 無座標
  const stats = rows.reduce(
    (acc, r) => {
      if (r.within_geofence === true) acc.inside++;
      else if (r.within_geofence === false) acc.outside++;
      else acc.unknown++;
      return acc;
    },
    { inside: 0, outside: 0, unknown: 0 },
  );

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-[#E0DCD6] bg-card p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">起始日</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-sm outline-none focus-visible:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">結束日</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-sm outline-none focus-visible:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">案件</label>
            <select
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
              className="h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-sm outline-none focus-visible:border-accent"
            >
              <option value="">全部案件</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">人員</label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-sm outline-none focus-visible:border-accent"
            >
              <option value="">全部人員</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={applyFilter} className="h-10 flex-1 bg-primary text-primary-foreground hover:bg-primary/90">
              套用
            </Button>
            <Button
              onClick={download}
              disabled={downloading || rows.length === 0}
              variant="outline"
              className="h-10"
            >
              {downloading ? "產生中…" : "下載 Excel"}
            </Button>
          </div>
        </div>
        {error && (
          <p className="mt-2 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
            {error}
          </p>
        )}
      </section>

      {/* 統計列 */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-md bg-[#F5F1EC] px-3 py-1">
          總計 <span className="font-semibold tabular-nums">{rows.length}</span> 筆
        </span>
        <span className="rounded-md bg-[#ECFDF5] px-3 py-1 text-[#15803D]">
          範圍內 <span className="font-semibold tabular-nums">{stats.inside}</span>
        </span>
        <span className="rounded-md bg-[#FFFBEB] px-3 py-1 text-[#92400E]">
          超出 <span className="font-semibold tabular-nums">{stats.outside}</span>
        </span>
        {stats.unknown > 0 && (
          <span className="rounded-md bg-[#F5F1EC] px-3 py-1 text-muted-foreground">
            無案件座標 <span className="font-semibold tabular-nums">{stats.unknown}</span>
          </span>
        )}
      </div>

      <AttendanceTimeline events={rows} showUser showCase emptyText="此範圍內沒有打卡紀錄" />
    </div>
  );
}
