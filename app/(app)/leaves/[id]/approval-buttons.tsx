"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { approveLeaveAction, rejectLeaveAction } from "../actions";

export function ApprovalButtons({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"approve" | "reject">("approve");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (mode === "reject" && comment.trim().length < 2) {
      setError("退回需要寫原因（至少 2 個字）");
      return;
    }
    startTransition(async () => {
      const res =
        mode === "approve"
          ? await approveLeaveAction({
              requestId,
              comment: comment.trim() || undefined,
            })
          : await rejectLeaveAction({
              requestId,
              comment: comment.trim(),
            });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // 慢網路下 refresh 靜靜結束會像沒反應 — 給明確回饋
      toast.success(mode === "approve" ? "已通過" : "已退回");
      router.refresh();
      setComment("");
    });
  }

  return (
    <div className="rounded-lg border border-[#E0DCD6] bg-card p-5">
      <div className="mb-4 inline-flex rounded-md border border-[#E0DCD6] p-1">
        <button
          type="button"
          onClick={() => setMode("approve")}
          className={`inline-flex min-h-11 items-center rounded-sm px-5 text-sm transition-colors ${
            mode === "approve"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          通過
        </button>
        <button
          type="button"
          onClick={() => setMode("reject")}
          className={`inline-flex min-h-11 items-center rounded-sm px-5 text-sm transition-colors ${
            mode === "reject"
              ? "bg-[#B91C1C] text-white"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          退回
        </button>
      </div>

      <textarea
        rows={3}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={
          mode === "approve"
            ? "備註（選填）"
            : "退回原因（必填，讓申請人知道哪裡要修）…"
        }
        className="block w-full resize-y rounded-md border border-[#E0DCD6] bg-white px-3 py-2.5 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
      />

      {error && (
        <p className="mt-3 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className={`mt-4 block h-12 w-full rounded-md text-base font-semibold shadow-sm transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${
          mode === "approve"
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "bg-[#B91C1C] text-white hover:bg-[#991B1B]"
        }`}
      >
        {isPending
          ? "處理中…"
          : mode === "approve"
            ? "通過 — 送下一關"
            : "退回 — 整份結束"}
      </button>
    </div>
  );
}
