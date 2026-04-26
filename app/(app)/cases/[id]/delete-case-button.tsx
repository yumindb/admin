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
        ? `確定要刪除「${caseName}」嗎？\n\n此案件有 ${workItemCount} 筆工項與所有匯入記錄會一併刪除,此動作無法復原。`
        : `確定要刪除「${caseName}」嗎?此動作無法復原。`;
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
      className="inline-flex items-center gap-1.5 rounded-md border border-[#E0DCD6] bg-white px-3 py-1.5 text-sm text-[#B91C1C] transition-colors hover:bg-[#FEF2F2] disabled:opacity-50"
    >
      <Trash2 className="size-4" />
      {isPending ? "刪除中…" : "刪除案件"}
    </button>
  );
}
