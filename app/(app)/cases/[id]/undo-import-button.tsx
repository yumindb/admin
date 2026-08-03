"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { undoImportAction } from "./import/actions";

/**
 * 「撤銷此次匯入」— 一下就會移除整批匯入的工項,必須過 ConfirmDialog
 * 且處理中鎖按鈕(大量工項刪除要跑幾秒,沒有 pending 會被連按)。
 * 手動修改過、日誌已引用的工項會被保留,結果用 toast 回報保留了幾項。
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await undoImportAction({ caseId, importId });
      setOpen(false);
      if (!res.ok) {
        toast.error(res.error ?? "撤銷失敗，請再試一次");
        return;
      }
      const keptParts: string[] = [];
      if (res.keptReferenced) keptParts.push(`日誌已引用 ${res.keptReferenced} 項`);
      if (res.keptModified) keptParts.push(`手動修改過 ${res.keptModified} 項`);
      if (res.keptAsParent) keptParts.push(`所屬分類 ${res.keptAsParent} 層`);
      toast.success(
        keptParts.length > 0
          ? `已撤銷匯入，移除 ${res.deleted ?? 0} 筆；保留：${keptParts.join("、")}`
          : `已撤銷匯入，移除 ${res.deleted ?? 0} 筆`,
        { duration: 6000 },
      );
      router.refresh();
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
        description="這批匯入建立的工項會被移除；手動修改過、或日誌已經引用的項目會保留，不會動到其他批匯入的資料。此動作無法復原，要重新匯入得再跑一次標單。"
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
