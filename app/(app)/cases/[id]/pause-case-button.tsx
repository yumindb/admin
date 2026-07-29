"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PauseCircle, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { setCaseStatusAction } from "./status-actions";

/**
 * 暫停 / 恢復施工按鈕(office_staff / owner)。
 *
 * 用途:等材料、業主喊停、天候停工這種「還沒結案但現在沒在做」的案子。
 * 暫停中的案件不會再被算進老闆儀表板的「案件停滯」警示 —
 * 這才是停滯提醒的正解(比每 7 天按一次「先不理」乾淨)。
 *
 * 與結案的差別:暫停仍可填日誌 / 打卡,隨時可恢復;結案會擋掉這些。
 */
export function PauseCaseButton({
  caseId,
  caseName,
  status,
}: {
  caseId: string;
  caseName: string;
  status: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  // 已結案的案子不給暫停(要先重新開啟)
  if (status === "closed") return null;

  const paused = status === "paused";
  const nextStatus = paused ? "active" : "paused";

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={isPending}
        title={paused ? "恢復施工" : "暫停施工"}
        className="inline-flex size-9 items-center justify-center rounded-md border border-[#E0DCD6] bg-white text-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-50 sm:h-9 sm:w-auto sm:justify-start sm:gap-1.5 sm:px-3"
      >
        {paused ? (
          <PlayCircle className="size-4 shrink-0" />
        ) : (
          <PauseCircle className="size-4 shrink-0" />
        )}
        <span className="hidden sm:inline">{paused ? "恢復施工" : "暫停"}</span>
      </button>
      <ConfirmDialog
        open={confirming}
        title={paused ? `恢復「${caseName}」？` : `暫停「${caseName}」？`}
        description={
          paused
            ? "案件回到「進行中」，老闆儀表板會重新監看這個案子有沒有太久沒填日誌。"
            : "暫停中的案件仍然可以填日誌、打卡，只是不會再出現在老闆儀表板的「案件停滯」提醒裡。等復工再按「恢復施工」就好。"
        }
        confirmText={paused ? "恢復施工" : "暫停"}
        pending={isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          startTransition(async () => {
            const res = await setCaseStatusAction(caseId, nextStatus);
            setConfirming(false);
            if (res.ok) {
              toast.success(paused ? "已恢復施工" : "已暫停，停滯提醒不會再跳");
              router.refresh();
            } else {
              toast.error(res.error);
            }
          })
        }
      />
    </>
  );
}
