"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  deleteSignatureStampAction,
  uploadSignatureStampAction,
} from "../logs/[id]/photo-actions";

/**
 * 簽名圖章卡(我的帳號;目前限 owner)。
 *
 * Phil 的需求:核定日誌像蓋章一樣,直接放上他預先簽好的簽名圖,
 * 印出來的 PDF 紙本比手寫板的字正式。
 *
 * 上傳前 client 端統一轉 PNG + 白底 + 寬度上限 1200px:
 * 手機拍的簽名照動輒 4000px / 好幾 MB,存那麼大沒意義,
 * PDF 呈現寬度也就幾百 px。
 */

const MAX_WIDTH = 1200;

export function SignatureStampCard({
  initialUrl,
}: {
  /** 已上傳圖章的 signed URL;null = 還沒上傳 */
  initialUrl: string | null;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("請選圖片檔（JPG / PNG）");
      return;
    }
    setBusy(true);
    try {
      const png = await toStampPng(file);
      const fd = new FormData();
      fd.append("file", new File([png], "stamp.png", { type: "image/png" }));
      const res = await uploadSignatureStampAction(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setUrl(res.url);
      toast.success("簽名圖章已儲存，之後核定可以直接蓋章");
    } catch {
      toast.error("圖片處理失敗，請換一張試試");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteSignatureStampAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setUrl(null);
      toast.success("已移除圖章，核定回到手寫簽名");
    });
  }

  return (
    <div>
      {url ? (
        <div className="mb-3 rounded-md border border-[#E0DCD6] bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="簽名圖章" className="mx-auto max-h-28" />
        </div>
      ) : (
        <div className="mb-3 rounded-md border border-dashed border-[#E0DCD6] bg-[#FAF7F2] px-4 py-6 text-center text-sm text-muted-foreground">
          還沒上傳圖章。上傳後核定日誌可以直接蓋章，不用每次手寫。
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "上傳中…" : url ? "更換圖章" : "上傳圖章"}
        </button>
        {url && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-[#F5F1EC] hover:text-[#B91C1C] disabled:opacity-50"
          >
            移除
          </button>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        建議用白底黑字的簽名圖（拍照或掃描都可以）。更換圖章不影響已核定的日誌
        — 每次蓋章當下的圖會單獨存檔。
      </p>
    </div>
  );
}

/** 圖片 → 白底 PNG,寬度上限 MAX_WIDTH(等比縮)。 */
async function toStampPng(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  // 白底:透明 PNG 或 HEIC 轉出來的透明區,在 PDF 上要跟紙一樣白
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
    );
  });
}
