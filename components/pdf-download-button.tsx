"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  getPdfDownloadUrlAction,
  regeneratePdfAction,
} from "@/app/(app)/logs/pdf-actions";

/**
 * 單份日誌的「下載 PDF」按鈕。
 *   - hasPdf: 已有 pdf_path,直接拿 signed URL 開新分頁
 *   - !hasPdf 但 approved: 顯示「產生 PDF」按鈕,觸發補產
 *   - 沒 approved: 不該顯示這個按鈕(by 上層判斷)
 */
export function PdfDownloadButton({
  logId,
  hasPdf,
  variant = "primary",
}: {
  logId: string;
  hasPdf: boolean;
  variant?: "primary" | "outline";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDownload() {
    setError(null);
    startTransition(async () => {
      const res = await getPdfDownloadUrlAction(logId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // 觸發瀏覽器下載
      const a = document.createElement("a");
      a.href = res.url;
      a.download = res.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }

  function onRegenerate() {
    setError(null);
    startTransition(async () => {
      const res = await regeneratePdfAction(logId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // 重新整理頁面拿到 pdf_path
      window.location.reload();
    });
  }

  const cls =
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : "border-[#E0DCD6]";
  const buttonVariant = variant === "primary" ? "default" : "outline";

  return (
    <div className="inline-flex flex-col items-end gap-1">
      {hasPdf ? (
        <Button
          type="button"
          onClick={onDownload}
          disabled={pending}
          variant={buttonVariant}
          className={cls}
        >
          {pending ? "下載中…" : "下載 PDF"}
        </Button>
      ) : (
        <Button
          type="button"
          onClick={onRegenerate}
          disabled={pending}
          variant="outline"
          className="border-[#E0DCD6]"
        >
          {pending ? "產生中…" : "產生 PDF"}
        </Button>
      )}
      {hasPdf && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={pending}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-accent hover:underline disabled:opacity-50"
        >
          {pending ? "處理中…" : "重新產生"}
        </button>
      )}
      {error && <span className="text-xs text-[#B91C1C]">{error}</span>}
    </div>
  );
}
