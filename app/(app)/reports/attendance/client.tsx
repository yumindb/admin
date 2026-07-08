"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AttendanceTimeline,
  type TimelineEvent,
} from "@/components/attendance-timeline";
import { backfillAttendanceAction, exportAttendanceXlsx } from "./actions";

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
  canBackfill = false,
}: {
  cases: CaseOpt[];
  users: UserOpt[];
  initialFrom: string;
  initialTo: string;
  initialCaseId: string;
  initialUserId: string;
  rows: EventRow[];
  /** office_staff / owner 才顯示「補登打卡」(server action 端也會再驗一次) */
  canBackfill?: boolean;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [caseId, setCaseId] = useState(initialCaseId);
  const [userId, setUserId] = useState(initialUserId);
  const [downloading, startDownload] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [backfillOpen, setBackfillOpen] = useState(false);

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
            {canBackfill && (
              <Button
                onClick={() => setBackfillOpen(true)}
                variant="outline"
                className="h-10 border-[#E0DCD6]"
                title="幫忘記打卡 / 手機沒電的同事補一筆"
              >
                補登打卡
              </Button>
            )}
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

      {backfillOpen && (
        <BackfillDialog
          users={users}
          cases={cases}
          onClose={() => setBackfillOpen(false)}
          onDone={() => {
            setBackfillOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/**
 * 補登打卡對話框(office_staff / owner)— migration-2.26。
 * 沒有 GPS,note 必填留原因;寫入後在時間軸與 Excel 都標「補登」。
 */
function BackfillDialog({
  users,
  cases,
  onClose,
  onDone,
}: {
  users: UserOpt[];
  cases: CaseOpt[];
  onClose: () => void;
  onDone: () => void;
}) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  const [userId, setUserId] = useState("");
  const [caseId, setCaseId] = useState("");
  const [eventType, setEventType] = useState<"clock_in" | "clock_out">("clock_in");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("07:30");
  const [note, setNote] = useState("");
  const [pending, startSave] = useTransition();

  function save() {
    if (!userId) {
      toast.error("請選擇人員");
      return;
    }
    if (note.trim().length < 2) {
      toast.error("請填補登原因（例：手機沒電）");
      return;
    }
    startSave(async () => {
      const res = await backfillAttendanceAction({
        userId,
        caseId: caseId || null,
        eventType,
        date,
        time,
        note: note.trim(),
      });
      if (res.ok) {
        toast.success("已補登，時間軸會標示「補登」");
        onDone();
      } else {
        toast.error(res.error);
      }
    });
  }

  const inputCls =
    "h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-sm outline-none focus-visible:border-accent";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={pending ? undefined : onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-lg border border-[#E0DCD6] bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[#E0DCD6] px-5 py-3">
          <h2 className="text-base font-semibold text-primary">補登打卡</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            給忘記打卡、手機沒電的同事補一筆。補登沒有 GPS，會標示「補登」以與現場打卡區隔。
          </p>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">人員（必選）</label>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className={inputCls}>
              <option value="">— 請選擇 —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">案件（可留空 = 無案件/移動中）</label>
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className={inputCls}>
              <option value="">（無案件）</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">上/下班</label>
              <select
                value={eventType}
                onChange={(e) => setEventType(e.target.value as "clock_in" | "clock_out")}
                className={inputCls}
              >
                <option value="clock_in">上班</option>
                <option value="clock_out">下班</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">日期</label>
              <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">時間</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">補登原因（必填，會留在紀錄上）</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例：手機沒電，主任口頭確認 07:30 到場"
              maxLength={200}
              className={inputCls}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#E0DCD6] px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending} className="border-[#E0DCD6]">
            取消
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={pending}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {pending ? "補登中…" : "確認補登"}
          </Button>
        </div>
      </div>
    </div>
  );
}
