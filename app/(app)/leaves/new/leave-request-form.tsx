"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitLeaveAction } from "../actions";
import { LEAVE_TYPE_LABEL } from "@/lib/leave";
import type { LeaveType } from "@/lib/types";

const TYPES: LeaveType[] = [
  "personal",
  "sick",
  "annual",
  "official",
  "menstrual",
  "bereavement",
  "marriage",
  "other",
];

/**
 * 預設值:今天 09:00 → 今天 18:00。datetime-local 用「使用者本地時間」格式,
 * server 端把它當台北時間(UTC+8)解析。
 */
function defaultStart(): string {
  return formatLocalInput(setHM(new Date(), 9, 0));
}
function defaultEnd(): string {
  return formatLocalInput(setHM(new Date(), 18, 0));
}
function setHM(d: Date, h: number, m: number): Date {
  const r = new Date(d);
  r.setHours(h, m, 0, 0);
  return r;
}
function formatLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LeaveRequestForm() {
  const router = useRouter();
  const [leaveType, setLeaveType] = useState<LeaveType>("personal");
  const [startAt, setStartAt] = useState(defaultStart());
  const [endAt, setEndAt] = useState(defaultEnd());
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const hoursPreview = useMemo(() => {
    if (!startAt || !endAt) return null;
    const s = new Date(startAt).getTime();
    const e = new Date(endAt).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
    const h = (e - s) / (1000 * 60 * 60);
    return Math.round(h * 2) / 2;
  }, [startAt, endAt]);

  function submit() {
    setError(null);
    if (!reason.trim()) {
      setError("請填請假事由");
      return;
    }
    if (hoursPreview === null) {
      setError("結束時間必須晚於起始時間");
      return;
    }
    const fd = new FormData();
    fd.set("leave_type", leaveType);
    fd.set("start_at", startAt);
    fd.set("end_at", endAt);
    fd.set("reason", reason);
    startTransition(async () => {
      const res = await submitLeaveAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/leaves/${res.requestId}`);
    });
  }

  function pickPreset(preset: "half_am" | "half_pm" | "full") {
    const base = new Date(startAt);
    if (preset === "half_am") {
      setStartAt(formatLocalInput(setHM(base, 9, 0)));
      setEndAt(formatLocalInput(setHM(base, 13, 0)));
    } else if (preset === "half_pm") {
      setStartAt(formatLocalInput(setHM(base, 14, 0)));
      setEndAt(formatLocalInput(setHM(base, 18, 0)));
    } else {
      setStartAt(formatLocalInput(setHM(base, 9, 0)));
      setEndAt(formatLocalInput(setHM(base, 18, 0)));
    }
  }

  return (
    <div className="space-y-5">
      {/* 假別 */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          假別
        </label>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setLeaveType(t)}
              aria-pressed={leaveType === t}
              className={`min-h-[44px] rounded-md border px-3 text-sm transition-colors ${
                leaveType === t
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-[#E0DCD6] bg-white text-foreground hover:bg-[#FAF7F2]"
              }`}
            >
              {LEAVE_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {/* 快速選 */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          快速選
        </label>
        <div className="flex flex-wrap gap-2">
          <PresetButton onClick={() => pickPreset("half_am")}>
            上午半天 (09–13)
          </PresetButton>
          <PresetButton onClick={() => pickPreset("half_pm")}>
            下午半天 (14–18)
          </PresetButton>
          <PresetButton onClick={() => pickPreset("full")}>
            整天 (09–18)
          </PresetButton>
        </div>
      </div>

      {/* 起迄時間 */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label
            htmlFor="leave-start"
            className="mb-2 block text-sm font-medium text-foreground"
          >
            起始時間
          </label>
          <input
            id="leave-start"
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="block h-12 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
        </div>
        <div>
          <label
            htmlFor="leave-end"
            className="mb-2 block text-sm font-medium text-foreground"
          >
            結束時間
          </label>
          <input
            id="leave-end"
            type="datetime-local"
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
            className="block h-12 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
        </div>
      </div>

      {/* 時數預覽 */}
      <div className="rounded-md border border-[#E0DCD6] bg-[#FAF7F2] px-4 py-3 text-sm">
        <span className="text-muted-foreground">合計時數：</span>
        <span className="ml-1 text-base font-semibold tabular-nums text-primary">
          {hoursPreview === null ? "—" : `${hoursPreview} 小時`}
        </span>
        <span className="ml-2 text-xs text-muted-foreground">
          （8 小時 = 1 天；以 0.5 小時為單位）
        </span>
      </div>

      {/* 事由 */}
      <div>
        <label
          htmlFor="leave-reason"
          className="mb-2 block text-sm font-medium text-foreground"
        >
          請假事由
        </label>
        <textarea
          id="leave-reason"
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="例：回診、家中有事、子女學校活動…"
          className="block w-full resize-y rounded-md border border-[#E0DCD6] bg-white px-3 py-2.5 text-base leading-relaxed outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
      </div>

      {error && (
        <p className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className="block h-14 w-full rounded-md bg-primary text-lg font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "送出中…" : "送出申請"}
      </button>
    </div>
  );
}

function PresetButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[40px] rounded-full border border-[#A07850]/40 bg-white px-4 text-sm text-foreground transition-colors hover:border-accent hover:bg-[#FAF7F2]"
    >
      {children}
    </button>
  );
}
