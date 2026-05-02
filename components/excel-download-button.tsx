"use client";

/**
 * 通用 Excel 下載按鈕。
 *
 * 不知道呼叫哪個 server action;由 caller 傳一個 fetch fn(`onFetch`)
 * 進來,內部負責處理 loading / error / 觸發瀏覽器下載。
 *
 * 用法(單案工項表):
 *   <ExcelDownloadButton
 *     label="下載 Excel"
 *     onFetch={() => getCaseWorkItemsXlsxAction(caseId)}
 *   />
 *
 * 用法(月報需挑年月):
 *   <ExcelMonthPicker .../> + <ExcelDownloadButton onFetch={() => getMonthly(...)} />
 *
 * 為什麼不直接傳 action ref:server action ref 帶不了泛型參數;讓 caller
 * 自己包成 () => Promise<Result> 才能吃到 caseId/year/month。
 */
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ExcelDownloadResult } from "@/app/(app)/cases/[id]/excel-actions";

export function ExcelDownloadButton({
  label,
  onFetch,
  variant = "outline",
  size = "lg",
  className,
}: {
  label: string;
  onFetch: () => Promise<ExcelDownloadResult>;
  variant?: "default" | "outline";
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await onFetch();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // dataURL → 觸發下載
      const a = document.createElement("a");
      a.href = res.dataUrl;
      a.download = res.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }

  const baseCls =
    variant === "default"
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : "border-[#E0DCD6]";

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={onClick}
        disabled={pending}
        className={`${baseCls} ${className ?? ""}`}
      >
        {pending ? "產生中…" : label}
      </Button>
      {error && (
        <span className="max-w-[20rem] text-right text-xs text-[#B91C1C]">
          {error}
        </span>
      )}
    </div>
  );
}
