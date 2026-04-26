"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import {
  approveLogAction,
  rejectLogAction,
  nextPendingRedirect,
} from "./actions";
import { uploadSignatureAction } from "../../logs/[id]/photo-actions";

export function ApprovalActions({ logId }: { logId: string }) {
  const router = useRouter();
  const sigRef = useRef<SignatureCanvas>(null);
  const [mode, setMode] = useState<"approve" | "reject">("approve");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function clearSig() {
    sigRef.current?.clear();
    setError(null);
  }

  function handleApprove() {
    setError(null);
    if (sigRef.current?.isEmpty()) {
      setError("請在下方簽名再核定");
      return;
    }
    const dataUrl = sigRef.current?.toDataURL("image/png");
    if (!dataUrl) {
      setError("簽名讀取失敗,請重試");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("dataUrl", dataUrl);
      const upload = await uploadSignatureAction(fd);
      if (!upload.ok) {
        setError(upload.error);
        return;
      }
      const res = await approveLogAction({
        logId,
        signatureUrl: upload.path,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess("已核定,跳下一份…");
      await nextPendingRedirect(logId);
    });
  }

  function handleReject() {
    setError(null);
    if (!comment.trim()) {
      setError("退回需要填原因");
      return;
    }
    startTransition(async () => {
      const res = await rejectLogAction({ logId, comment });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess("已退回,跳下一份…");
      await nextPendingRedirect(logId);
    });
  }

  return (
    <div className="rounded-lg border border-[#E0DCD6] bg-card p-5 md:p-6">
      <div className="mb-4 inline-flex rounded-md border border-[#E0DCD6] p-1">
        <button
          type="button"
          onClick={() => setMode("approve")}
          className={`rounded-sm px-4 py-1.5 text-sm transition-colors ${
            mode === "approve"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          通過
        </button>
        <button
          type="button"
          onClick={() => setMode("reject")}
          className={`rounded-sm px-4 py-1.5 text-sm transition-colors ${
            mode === "reject"
              ? "bg-[#B91C1C] text-white"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          退回
        </button>
      </div>

      {mode === "approve" ? (
        <div>
          <p className="mb-2 text-sm text-muted-foreground">
            在下方手寫板簽名後按「核定通過」
          </p>
          {/* touch-action: none 防止簽名時整頁跟著手指捲動 */}
          <div
            className="rounded-md border border-[#E0DCD6] bg-white"
            style={{ touchAction: "none" }}
          >
            <SignatureCanvas
              ref={sigRef}
              penColor="#003153"
              canvasProps={{
                className: "w-full",
                style: { width: "100%", height: "260px", touchAction: "none" },
              }}
            />
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={clearSig}
              className="text-xs text-muted-foreground hover:text-accent"
            >
              清除重簽
            </button>
          </div>
          <Button
            onClick={handleApprove}
            disabled={isPending}
            className="mt-4 h-12 w-full bg-primary text-base text-primary-foreground hover:bg-primary/90"
          >
            {isPending ? "處理中…" : "核定通過"}
          </Button>
        </div>
      ) : (
        <div>
          <p className="mb-2 text-sm text-muted-foreground">
            選一個常用原因,或自由輸入
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            {[
              "照片不夠清楚",
              "工項數量怪怪的",
              "請補拍照片",
              "工項漏報",
              "備註不清楚",
            ].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setComment(r)}
                className={`min-h-[44px] rounded-md border px-3 text-sm transition-colors ${
                  comment === r
                    ? "border-[#B91C1C] bg-[#FEF2F2] text-[#B91C1C]"
                    : "border-[#E0DCD6] bg-white text-foreground hover:bg-[#FAF7F2]"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="或自由輸入退回原因…"
            className="w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
          <Button
            onClick={handleReject}
            disabled={isPending || !comment.trim()}
            className="mt-4 h-12 w-full bg-[#B91C1C] text-base text-white hover:bg-[#991B1B]"
          >
            {isPending ? "處理中…" : "退回"}
          </Button>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          {error}
        </p>
      )}
      {success && (
        <p className="mt-3 rounded-md border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-2 text-sm text-[#4A7C59]">
          {success}
        </p>
      )}
    </div>
  );
}
