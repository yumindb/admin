"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  getPdfDownloadUrlAction,
  regeneratePdfAction,
} from "@/app/(app)/logs/pdf-actions";
import type { PdfStatus } from "@/lib/types";

/**
 * 單份日誌的「下載 PDF」按鈕。
 * 依 pdf_status 顯示不同 state:
 *   - generating : 「PDF 生成中…」spinner,disabled
 *   - failed     : 顯示錯誤訊息 + 「重新產生」按鈕
 *   - done       : 「下載 PDF」+ 小字「重新產生」
 *   - pending    : approved 但 PDF 還沒進入 generating(舊資料 / race) → 「產生 PDF」
 */
export function PdfDownloadButton({
  logId,
  hasPdf,
  pdfStatus = "pending",
  pdfError = null,
  variant = "primary",
}: {
  logId: string;
  hasPdf: boolean;
  pdfStatus?: PdfStatus;
  pdfError?: string | null;
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
      // 重新整理頁面拿到 pdf_path / pdf_status
      window.location.reload();
    });
  }

  const cls =
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : "border-[#E0DCD6]";
  const buttonVariant = variant === "primary" ? "default" : "outline";

  // generating: 顯示 spinner button(無動作)
  if (pdfStatus === "generating") {
    return (
      <div className="inline-flex flex-col items-end gap-1">
        <Button
          type="button"
          disabled
          variant="outline"
          className="border-[#E0DCD6]"
        >
          PDF 生成中…
        </Button>
      </div>
    );
  }

  // failed: 顯示錯誤 + 重新產生
  if (pdfStatus === "failed") {
    return (
      <div className="inline-flex flex-col items-end gap-1">
        <Button
          type="button"
          onClick={onRegenerate}
          disabled={pending}
          variant="outline"
          className="border-[#FCA5A5] text-[#B91C1C] hover:bg-[#FEF2F2]"
        >
          {pending ? "產生中…" : "重新產生 PDF"}
        </Button>
        <span className="max-w-[16rem] text-right text-[11px] text-[#B91C1C]">
          生成失敗:{pdfError ?? "未知原因"}
        </span>
        {error && <span className="text-xs text-[#B91C1C]">{error}</span>}
      </div>
    );
  }

  // done / pending: 同舊邏輯,只是 done 走 hasPdf=true
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
