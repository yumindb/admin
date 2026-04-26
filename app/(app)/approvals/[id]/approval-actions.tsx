"use client";

import { useRef, useState, useTransition } from "react";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import {
  approveStageAction,
  rejectStageAction,
  nextPendingRedirect,
} from "./actions";
import { uploadSignatureAction } from "../../logs/[id]/photo-actions";
import type { ApprovalStage } from "@/lib/types";

const VERB: Record<ApprovalStage, string> = {
  review: "複核通過",
  audit: "審核通過",
  approve: "核定通過",
};

export function ApprovalActions({
  logId,
  stage,
}: {
  logId: string;
  stage: ApprovalStage;
}) {
  const sigRef = useRef<SignatureCanvas>(null);
  const [mode, setMode] = useState<"approve" | "reject">("approve");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const requireSignature = stage === "approve";

  function clearSig() {
    sigRef.current?.clear();
    setError(null);
  }

  function handleApprove() {
    setError(null);

    let signaturePromise: Promise<string | undefined> = Promise.resolve(undefined);

    if (requireSignature) {
      if (sigRef.current?.isEmpty()) {
        setError("請在下方簽名再核定");
        return;
      }
      const dataUrl = sigRef.current?.toDataURL("image/png");
      if (!dataUrl) {
        setError("簽名讀取失敗,請重試");
        return;
      }
      signaturePromise = (async () => {
        const fd = new FormData();
        fd.set("dataUrl", dataUrl);
        const upload = await uploadSignatureAction(fd);
        if (!upload.ok) throw new Error(upload.error);
        return upload.path;
      })();
    }

    startTransition(async () => {
      let signatureUrl: string | undefined;
      try {
        signatureUrl = await signaturePromise;
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      const res = await approveStageAction({
        logId,
        signatureUrl,
        comment: comment.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess(`已${VERB[stage]},跳下一份…`);
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
      const res = await rejectStageAction({ logId, comment });
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
          {requireSignature ? (
            <>
              <p className="mb-2 text-sm text-muted-foreground">
                在下方手寫板簽名後按「核定通過」
              </p>
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
            </>
          ) : (
            <p className="mb-2 text-sm text-muted-foreground">
              通過後,日誌會自動推進到下一關。可在下方加備註(選填)。
            </p>
          )}

          {!requireSignature && (
            <textarea
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="備註(選填,例如:照片不錯、補充說明等)"
              className="mt-3 w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            />
          )}

          {!requireSignature && (
            <p className="mt-3 text-xs text-muted-foreground">
              這關不需簽名圖,只要點下方按鈕就會推進到下一關。
            </p>
          )}

          <Button
            onClick={handleApprove}
            disabled={isPending}
            className="mt-4 h-12 w-full bg-primary text-base text-primary-foreground hover:bg-primary/90"
          >
            {isPending ? "處理中…" : VERB[stage]}
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
