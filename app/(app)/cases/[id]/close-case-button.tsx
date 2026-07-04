"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog, type ConfirmDetail } from "@/components/ui/confirm-dialog";
import {
  getCloseChecklistAction,
  setCaseStatusAction,
  type CloseChecklist,
} from "./status-actions";

/**
 * 結案 / 重新開啟按鈕(office_staff / owner)。
 *
 * 結案前先跑防漏財 checklist:未簽約項目(尤其還沒報價的)、
 * 簽核中/草稿日誌、待處理回報,全部攤在確認框裡再讓人按下去。
 * 軟性警告不硬擋 — 但危險狀態會用紅色 destructive 樣式。
 */
export function CloseCaseButton({
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
  const [checklist, setChecklist] = useState<CloseChecklist | null>(null);
  const [confirmingReopen, setConfirmingReopen] = useState(false);

  if (status === "closed") {
    return (
      <>
        <button
          type="button"
          onClick={() => setConfirmingReopen(true)}
          disabled={isPending}
          title="重新開啟案件"
          className="inline-flex size-9 items-center justify-center rounded-md border border-[#E0DCD6] bg-white text-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-50 sm:h-9 sm:w-auto sm:justify-start sm:gap-1.5 sm:px-3"
        >
          <ArchiveRestore className="size-4 shrink-0" />
          <span className="hidden sm:inline">重新開啟</span>
        </button>
        <ConfirmDialog
          open={confirmingReopen}
          title={`重新開啟「${caseName}」？`}
          description="案件會回到「進行中」，主任可以繼續填日誌、打卡。"
          confirmText="重新開啟"
          pending={isPending}
          onCancel={() => setConfirmingReopen(false)}
          onConfirm={() =>
            startTransition(async () => {
              const res = await setCaseStatusAction(caseId, "active");
              setConfirmingReopen(false);
              if (res.ok) {
                toast.success("案件已重新開啟");
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

  const risky =
    !!checklist &&
    (checklist.unsignedCount > 0 || checklist.pendingLogCount > 0);

  const details: ConfirmDetail[] = checklist
    ? [
        {
          label: "未簽約項目",
          value:
            checklist.unsignedCount === 0
              ? "0 筆 ✓"
              : `${checklist.unsignedCount} 筆（${checklist.unquotedCount} 筆未報價）`,
        },
        {
          label: "簽核中日誌",
          value: checklist.pendingLogCount === 0 ? "0 份 ✓" : `${checklist.pendingLogCount} 份`,
        },
        {
          label: "草稿日誌",
          value: checklist.draftLogCount === 0 ? "0 份 ✓" : `${checklist.draftLogCount} 份`,
        },
        {
          label: "待處理回報",
          value:
            checklist.pendingReportCount === 0 ? "0 筆 ✓" : `${checklist.pendingReportCount} 筆`,
        },
      ]
    : [];

  const description = checklist
    ? checklist.unsignedCount > 0
      ? `⚠ 這個案子還有沒收完的錢：${checklist.unsignedNames
          .slice(0, 5)
          .map((n) => `「${n}」`)
          .join("、")}${checklist.unsignedCount > 5 ? " 等" : ""}尚未簽約${
          checklist.unquotedCount > 0 ? `（其中 ${checklist.unquotedCount} 筆連報價都還沒填）` : ""
        }。\n結案後案件會從進行中清單消失，這些項目很容易被忘掉 — 建議先報價、簽約或轉入追加合約再結案。`
      : checklist.pendingLogCount > 0
        ? "還有日誌在簽核流程中。結案不會中斷簽核，但建議先簽完再結案，帳比較乾淨。"
        : "未簽約項目與簽核都已處理完畢，可以放心結案。結案後主任就不能再對此案填日誌或打卡。"
    : "";

  return (
    <>
      <button
        type="button"
        onClick={() =>
          startTransition(async () => {
            const res = await getCloseChecklistAction(caseId);
            if (res.ok) setChecklist(res.checklist);
            else toast.error(res.error);
          })
        }
        disabled={isPending}
        title="結案"
        className="inline-flex size-9 items-center justify-center rounded-md border border-[#E0DCD6] bg-white text-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-50 sm:h-9 sm:w-auto sm:justify-start sm:gap-1.5 sm:px-3"
      >
        <Archive className="size-4 shrink-0" />
        <span className="hidden sm:inline">{isPending && !checklist ? "檢查中…" : "結案"}</span>
      </button>
      <ConfirmDialog
        open={!!checklist}
        title={`結案「${caseName}」？`}
        description={description}
        details={details}
        confirmText={risky ? "我了解，仍要結案" : "確認結案"}
        danger={risky}
        pending={isPending}
        onCancel={() => setChecklist(null)}
        onConfirm={() =>
          startTransition(async () => {
            const res = await setCaseStatusAction(caseId, "closed");
            setChecklist(null);
            if (res.ok) {
              toast.success("案件已結案");
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
