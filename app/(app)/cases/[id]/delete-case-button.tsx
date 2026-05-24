"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteCaseAction } from "./edit/actions";

export function DeleteCaseButton({
  caseId,
  caseName,
  workItemCount,
}: {
  caseId: string;
  caseName: string;
  workItemCount: number;
}) {
  const [isPending, startTransition] = useTransition();

  function onClick() {
    const msg =
      workItemCount > 0
        ? `確定要刪除「${caseName}」嗎？\n\n此案件有 ${workItemCount} 筆工項與所有匯入記錄會一併刪除，此動作無法復原。`
        : `確定要刪除「${caseName}」嗎？此動作無法復原。`;
    if (!confirm(msg)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("caseId", caseId);
      await deleteCaseAction(fd);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      title="刪除案件"
      className="inline-flex size-9 items-center justify-center rounded-md border border-[#E0DCD6] bg-white text-[#B91C1C] transition-colors hover:bg-[#FEF2F2] disabled:opacity-50 sm:h-9 sm:w-auto sm:justify-start sm:gap-1.5 sm:px-3"
    >
      <Trash2 className="size-4 shrink-0" />
      <span className="hidden sm:inline">{isPending ? "刪除中…" : "刪除案件"}</span>
    </button>
  );
}
