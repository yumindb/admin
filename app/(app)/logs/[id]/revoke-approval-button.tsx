"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { revokeApprovalAction } from "../../approvals/[id]/actions";

/**
 * 撤回核定(office_staff / owner,只在已核定的日誌出現)。
 *
 * 業主 2026-08:主任填錯常常是核定完才發現,助理要能把日誌拉回來改。
 * 已核定的日誌仍然不開放直接編輯 — 先撤回到「審核」關,改完重新走核定,
 * 這樣簽名與 PDF 才不會跟內容對不上。
 */
export function RevokeApprovalButton({ logId }: { logId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={isPending}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#E0DCD6] bg-white px-3 text-sm text-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
      >
        <Undo2 className="size-4 shrink-0" />
        撤回核定
      </button>
      <ConfirmDialog
        open={confirming}
        title="撤回這份日誌的核定？"
        description="日誌會回到「審核（辦公室助理）」關，內容就能修改。已完成的核定簽名作廢，改完要重新送核定、重新簽名，PDF 也會重新產生。"
        details={[
          { label: "撤回後狀態", value: "簽核中：審核" },
          { label: "核定簽名", value: "作廢，需重簽" },
          { label: "目前的 PDF", value: "保留，但標為撤回前版本" },
        ]}
        confirmText="撤回核定"
        danger
        pending={isPending}
        confirmDisabled={!reason.trim()}
        onCancel={() => {
          setConfirming(false);
          setReason("");
        }}
        onConfirm={() =>
          startTransition(async () => {
            const res = await revokeApprovalAction({ logId, reason });
            if (res.ok) {
              setConfirming(false);
              setReason("");
              toast.success("已撤回核定，日誌回到審核關可以修改了");
              router.refresh();
            } else {
              toast.error(res.error);
            }
          })
        }
      >
        <div className="space-y-1.5">
          <label
            htmlFor="revoke_reason"
            className="text-sm font-medium text-primary"
          >
            撤回原因（必填，會留在簽核歷程）
          </label>
          <Textarea
            id="revoke_reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例：工項數量填錯，要改成實際完成的 15 米"
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
