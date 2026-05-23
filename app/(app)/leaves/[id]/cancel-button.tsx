"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelLeaveAction } from "../actions";

export function CancelButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function doCancel() {
    setError(null);
    startTransition(async () => {
      const res = await cancelLeaveAction({ requestId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex h-11 items-center rounded-md border border-[#E0DCD6] bg-white px-5 text-sm text-foreground hover:border-[#B91C1C] hover:text-[#B91C1C]"
      >
        取消這份申請
      </button>
    );
  }

  return (
    <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-4">
      <p className="text-sm text-[#B91C1C]">
        確定要取消?取消後不可復原,要請假請重送新的一份。
      </p>
      {error && (
        <p className="mt-2 rounded-md border border-[#FCA5A5] bg-white px-3 py-2 text-sm text-[#B91C1C]">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={doCancel}
          disabled={isPending}
          className="inline-flex h-11 items-center rounded-md bg-[#B91C1C] px-5 text-sm font-semibold text-white hover:bg-[#991B1B] disabled:opacity-50"
        >
          {isPending ? "取消中…" : "確定取消"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="inline-flex h-11 items-center rounded-md border border-[#E0DCD6] bg-white px-5 text-sm text-foreground hover:bg-[#FAF7F2]"
        >
          再想想
        </button>
      </div>
    </div>
  );
}
