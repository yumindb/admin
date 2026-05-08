"use client";

/**
 * 辦公室助理 / 老闆專屬:現場回報處理工具列。
 *
 * 三個操作:
 *   1. 一鍵下載全部照片(各別 fetch + a-download,不打包 zip — 量小,簡單)
 *   2. 封存(status='archived'):退出 pending 列表,但保留資料當審計
 *   3. 刪除(僅 pending / archived):整筆砍掉
 *
 * merged 的回報只有「下載」+「刪除」是被擋的(daily_log 還反向引用著)
 * — 想清乾淨改用封存。canDelete / canArchive 的決策放在 server-side page。
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Download, Trash2 } from "lucide-react";
import { archiveFieldReportAction, deleteFieldReportAction } from "../actions";

type Photo = { path: string; caption: string };

export function OfficeReportTools({
  reportId,
  photos,
  canDelete,
  canArchive,
}: {
  reportId: string;
  photos: Photo[];
  canDelete: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ done: 0, total: 0 });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function downloadAll() {
    if (!photos.length || downloading) return;
    setDownloading(true);
    setFeedback(null);
    setDownloadProgress({ done: 0, total: photos.length });

    let okCount = 0;
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      try {
        const res = await fetch(p.path, { mode: "cors" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const ext = guessExt(blob.type, p.path) || "jpg";
        const safeCap = (p.caption || "")
          .replace(/[\\/:*?"<>|]/g, "")
          .replace(/\s+/g, "_")
          .slice(0, 60);
        const stem = safeCap || `photo-${i + 1}`;
        const filename = `${reportId.slice(0, 8)}-${stem}.${ext}`;
        triggerDownload(blob, filename);
        okCount += 1;
      } catch {
        // 單張失敗略過,繼續下一張
      }
      setDownloadProgress({ done: i + 1, total: photos.length });
    }

    setDownloading(false);
    setDownloadProgress({ done: 0, total: 0 });
    if (okCount === photos.length) {
      setFeedback(`已下載 ${okCount} 張照片`);
    } else {
      setFeedback(`已下載 ${okCount} / ${photos.length} 張(部分失敗)`);
    }
  }

  function handleArchive() {
    if (!confirm("封存後此回報不再出現在主任的待整合列表。資料仍保留可查。")) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("reportId", reportId);
      const result = await archiveFieldReportAction(fd);
      if (!result.ok) {
        setFeedback(`封存失敗:${result.error ?? "unknown"}`);
        return;
      }
      setFeedback("已封存");
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm("確定刪除此回報?照片與文字都會清掉,無法復原。\n建議先按「下載全部」備份。")) return;
    startTransition(() => {
      const fd = new FormData();
      fd.set("reportId", reportId);
      // server action 自帶 redirect 到 /field-reports
      void deleteFieldReportAction(fd);
    });
  }

  return (
    <div className="mb-6 rounded-md border border-[#E0DCD6] bg-[#FAF7F2] px-4 py-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        辦公室處理工具
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={downloadAll}
          disabled={downloading || photos.length === 0}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#E0DCD6] bg-white px-3 text-sm text-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          <Download className="size-4" />
          {downloading
            ? `下載中… ${downloadProgress.done} / ${downloadProgress.total}`
            : `下載全部照片 (${photos.length})`}
        </button>
        {canArchive && (
          <button
            type="button"
            onClick={handleArchive}
            disabled={isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#E0DCD6] bg-white px-3 text-sm text-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            <Archive className="size-4" />
            封存
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#FCA5A5] bg-white px-3 text-sm text-[#B91C1C] transition-colors hover:bg-[#FEF2F2] disabled:opacity-50"
          >
            <Trash2 className="size-4" />
            刪除整筆
          </button>
        )}
      </div>
      {feedback && (
        <p className="mt-2 text-xs text-muted-foreground">{feedback}</p>
      )}
    </div>
  );
}

function guessExt(mime: string, path: string): string | null {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/heic") return "heic";
  if (mime === "image/webp") return "webp";
  // 退回從路徑中拆出來
  const m = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(path);
  return m ? m[1].toLowerCase() : null;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
