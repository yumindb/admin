"use client";

import { useRef, useState, useTransition } from "react";
import SignatureCanvas from "react-signature-canvas";
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
  // 手寫建立圖章:攤開手寫板(手機沒有現成簽名圖檔的人直接寫一個)
  const [drawing, setDrawing] = useState(false);
  const sigRef = useRef<SignatureCanvas>(null);

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

  /** 手寫板內容 → 白底 PNG 圖章上傳。裁掉四周空白再留一點 padding。 */
  async function handleSaveDrawn() {
    const sig = sigRef.current;
    if (!sig || sig.isEmpty()) {
      toast.error("請先在手寫板上簽名");
      return;
    }
    setBusy(true);
    try {
      const trimmed = sig.getTrimmedCanvas();
      const pad = Math.round(Math.max(trimmed.width, trimmed.height) * 0.08);
      const canvas = document.createElement("canvas");
      canvas.width = trimmed.width + pad * 2;
      canvas.height = trimmed.height + pad * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(trimmed, pad, pad);
      const png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
          "image/png",
        );
      });
      const fd = new FormData();
      fd.append("file", new File([png], "stamp.png", { type: "image/png" }));
      const res = await uploadSignatureStampAction(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setUrl(res.url);
      setDrawing(false);
      toast.success("簽名圖章已儲存，之後核定可以直接蓋章");
    } catch {
      toast.error("簽名處理失敗，請再試一次");
    } finally {
      setBusy(false);
    }
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

      {drawing && (
        <div className="mb-3">
          <p className="mb-2 text-sm text-muted-foreground">
            在下方手寫板簽名，寫好按「存成圖章」
          </p>
          <div
            className="rounded-md border border-[#E0DCD6] bg-white"
            style={{ touchAction: "none" }}
          >
            <SignatureCanvas
              ref={sigRef}
              penColor="#003153"
              minWidth={2}
              maxWidth={4}
              clearOnResize={false}
              canvasProps={{
                className: "w-full",
                style: {
                  width: "100%",
                  height: "clamp(180px, 28vh, 260px)",
                  touchAction: "none",
                },
              }}
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSaveDrawn()}
              disabled={busy}
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "儲存中…" : "存成圖章"}
            </button>
            <button
              type="button"
              onClick={() => sigRef.current?.clear()}
              disabled={busy}
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-[#F5F1EC] hover:text-accent disabled:opacity-50"
            >
              清除重寫
            </button>
            <button
              type="button"
              onClick={() => setDrawing(false)}
              disabled={busy}
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-[#F5F1EC] disabled:opacity-50"
            >
              取消
            </button>
          </div>
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
      {!drawing && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "上傳中…" : url ? "上傳圖檔更換" : "上傳圖檔"}
          </button>
          <button
            type="button"
            onClick={() => setDrawing(true)}
            disabled={busy}
            className="inline-flex min-h-11 items-center rounded-md border border-[#E0DCD6] bg-white px-4 text-sm font-medium text-foreground hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {url ? "手寫更換" : "手寫建立"}
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
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        可以上傳白底黑字的簽名圖（拍照或掃描都可以），也可以直接在手機上手寫一個。
        更換圖章不影響已核定的日誌 — 每次蓋章當下的圖會單獨存檔。
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
