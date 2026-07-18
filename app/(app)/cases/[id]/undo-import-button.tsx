"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { undoImportAction } from "./import/actions";

/**
 * 「撤銷此次匯入」— 一下就會移除整批匯入的工項,必須過 ConfirmDialog
 * 且處理中鎖按鈕(大量工項刪除要跑幾秒,沒有 pending 會被連按)。
 */
export function UndoImportButton({
  caseId,
  importId,
  fileName,
  importedCount,
}: {
  caseId: string;
  importId: string;
  fileName: string;
  importedCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("caseId", caseId);
      fd.set("importId", importId);
      await undoImportAction(fd);
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-md px-3 text-sm text-[#B91C1C] underline-offset-2 hover:underline"
      >
        撤銷此次匯入
      </button>
      <ConfirmDialog
        open={open}
        title="撤銷此次匯入？"
        description="這批匯入建立的工項會被移除（手動修改過的項目會保留）。此動作無法復原，要重新匯入得再跑一次標單。"
        details={[
          { label: "檔案", value: fileName },
          { label: "此次匯入", value: `${importedCount} 項` },
        ]}
        confirmText="確認撤銷"
        danger
        pending={pending}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
