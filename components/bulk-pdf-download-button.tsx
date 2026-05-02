"use client";

import { useState, useTransition } from "react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { bulkDownloadPdfsAction } from "@/app/(app)/logs/pdf-actions";

/**
 * 一次把多份日誌的 PDF 包 zip 下載。
 * 通常用在「同案件下所有 approved 日誌」的群組標題列。
 *
 * 流程(W4-3 起改 client-side zip,避免 server response 超 4MB):
 *   1. server action 回傳每份 PDF 的 signed URL 與檔名
 *   2. client 4-concurrency fetch 每個 signedUrl
 *   3. JSZip 在瀏覽器組 zip → blob → 觸發下載
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
      // 4-concurrency 在瀏覽器 fetch 每個 signed URL
      const zip = new JSZip();
      const concurrency = 4;
      let cursor = 0;
      let fetchFailed = 0;
      const items = res.items;
      const workers = Array.from(
        { length: Math.min(concurrency, items.length) },
        async () => {
          while (true) {
            const i = cursor++;
            if (i >= items.length) return;
            const it = items[i];
            try {
              const r = await fetch(it.signedUrl);
              if (!r.ok) {
                fetchFailed++;
                continue;
              }
              const buf = await r.arrayBuffer();
              zip.file(it.fileName, buf);
            } catch {
              fetchFailed++;
            }
          }
        }
      );
      await Promise.all(workers);

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.zipFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      const totalSkipped = res.skipped + fetchFailed;
      if (totalSkipped > 0) {
        setError(
          `成功 ${res.included - fetchFailed} 份,跳過 ${totalSkipped} 份(未核定 / 產 PDF / 下載失敗)`
        );
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
