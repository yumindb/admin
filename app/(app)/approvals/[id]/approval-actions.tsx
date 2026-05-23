"use client";

import { useRef, useState, useTransition } from "react";
import SignatureCanvas from "react-signature-canvas";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  approveStageAction,
  rejectStageAction,
  nextPendingRedirect,
} from "./actions";
import { uploadSignatureAction } from "../../logs/[id]/photo-actions";
import type { ApprovalStage } from "@/lib/types";

const VERB: Record<ApprovalStage, string> = {
  fill: "送出",
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
  // 退回原因 chip 改成 toggle:每個 chip 可獨立選/取消,送出時與自由文字合併
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  function toggleChip(chip: string) {
    setSelectedChips((prev) =>
      prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip],
    );
  }

  // chips 與自由文字合併:chips 用「、」串,後接自由文字(若有)
  function buildRejectComment(): string {
    const chipPart = selectedChips.join("、");
    const freeText = comment.trim();
    if (chipPart && freeText) return `${chipPart}\n${freeText}`;
    return chipPart || freeText;
  }

  function clearSig() {
    sigRef.current?.clear();
  }

  function handleApprove() {
    if (sigRef.current?.isEmpty()) {
      toast.error(`請在下方簽名再${VERB[stage]}`);
      return;
    }
    const dataUrl = sigRef.current?.toDataURL("image/png");
    if (!dataUrl) {
      toast.error("簽名讀取失敗,請重試");
      return;
    }
    const signaturePromise = (async () => {
      const fd = new FormData();
      fd.set("dataUrl", dataUrl);
      const upload = await uploadSignatureAction(fd);
      if (!upload.ok) throw new Error(upload.error);
      return upload.path;
    })();

    startTransition(async () => {
      let signatureUrl: string;
      try {
        signatureUrl = await signaturePromise;
      } catch (e) {
        toast.error((e as Error).message);
        return;
      }
      const res = await approveStageAction({
        logId,
        signatureUrl,
        comment: comment.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`已${VERB[stage]}`, { description: "跳下一份…" });
      await nextPendingRedirect(logId);
    });
  }

  function handleReject() {
    const finalComment = buildRejectComment();
    if (!finalComment) {
      toast.error("退回需要填原因");
      return;
    }
    startTransition(async () => {
      const res = await rejectStageAction({ logId, comment: finalComment });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("已退回", { description: "跳下一份…" });
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
            在下方手寫板簽名後按「{VERB[stage]}」
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

          <Textarea
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="備註(選填,例如:照片不錯、補充說明等)"
            className="mt-3"
          />

          <Button
            size="xl"
            onClick={handleApprove}
            disabled={isPending}
            className="mt-4 w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isPending ? "處理中…" : VERB[stage]}
          </Button>
        </div>
      ) : (
        <div>
          <p className="mb-2 text-sm text-muted-foreground">
            選常用原因（可複選），或自由輸入
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            {[
              "照片不夠清楚",
              "工項數量怪怪的",
              "請補拍照片",
              "工項漏報",
              "備註不清楚",
              "跟我口頭交代不一樣",
              "天氣對不上",
              "外包人數對不起來",
            ].map((r) => {
              const active = selectedChips.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggleChip(r)}
                  aria-pressed={active}
                  className={`min-h-[44px] rounded-md border px-3 text-sm transition-colors ${
                    active
                      ? "border-[#B91C1C] bg-[#FEF2F2] text-[#B91C1C]"
                      : "border-[#E0DCD6] bg-white text-foreground hover:bg-[#FAF7F2]"
                  }`}
                >
                  {active ? "✓ " : ""}
                  {r}
                </button>
              );
            })}
          </div>

          {/* 已選 chip 列在 textarea 上方,點即可移除 */}
          {selectedChips.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5 rounded-md border border-[#E0DCD6] bg-[#FAF7F2] px-2 py-2">
              <span className="self-center text-xs text-muted-foreground">
                已選原因:
              </span>
              {selectedChips.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggleChip(r)}
                  className="inline-flex items-center gap-1 rounded-full border border-[#B91C1C]/40 bg-white px-2 py-0.5 text-xs text-[#B91C1C] hover:bg-[#FEF2F2]"
                  aria-label={`移除「${r}」`}
                >
                  {r}
                  <span aria-hidden>×</span>
                </button>
              ))}
            </div>
          )}

          <Textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="自由輸入補充說明（與上方 chips 一起送出）…"
          />
          <Button
            size="xl"
            onClick={handleReject}
            disabled={isPending || !buildRejectComment()}
            className="mt-4 w-full bg-[#B91C1C] text-white hover:bg-[#991B1B]"
          >
            {isPending ? "處理中…" : "退回"}
          </Button>
        </div>
      )}

    </div>
  );
}
