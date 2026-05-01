"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { bulkDownloadPdfsAction } from "@/app/(app)/logs/pdf-actions";

/**
 * 一次把多份日誌的 PDF 包 zip 下載。
 * 通常用在「同案件下所有 approved 日誌」的群組標題列。
 */
export function BulkPdfDownloadButton({
  logIds,
  label,
  labelMd,
}: {
  logIds: string[];
  label?: string;
  labelMd?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    if (logIds.length === 0) {
      setError("沒有可下載的日誌");
      return;
    }
    startTransition(async () => {
      const res = await bulkDownloadPdfsAction(logIds);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // base64 → Blob → 觸發下載
      const binary = atob(res.zipBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (res.skipped > 0) {
        setError(`成功 ${res.included} 份,跳過 ${res.skipped} 份(未核定或產 PDF 失敗)`);
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="border-[#E0DCD6] text-xs"
        onClick={onClick}
        disabled={pending || logIds.length === 0}
      >
        {pending ? (
          "打包中…"
        ) : labelMd ? (
          <>
            <span className="md:hidden">{label ?? `下載 ${logIds.length} 份 PDF`}</span>
            <span className="hidden md:inline">{labelMd}</span>
          </>
        ) : (
          label ?? `下載 ${logIds.length} 份 PDF`
        )}
      </Button>
      {error && <span className="text-[10px] text-[#B91C1C]">{error}</span>}
    </span>
  );
}
