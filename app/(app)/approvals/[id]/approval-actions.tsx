"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import SignatureCanvas from "react-signature-canvas";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  approveStageAction,
  rejectStageAction,
  nextPendingRedirect,
  getPendingCount,
} from "./actions";
import { uploadSignatureAction } from "../../logs/[id]/photo-actions";
import {
  readRememberedSig,
  writeRememberedSig,
  clearRememberedSig,
} from "@/lib/remembered-signature";
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
  // 「記住簽名」勾選 — 預設根據是否已有 cache 推斷:有就維持勾,沒就不勾
  const [remember, setRemember] = useState(false);
  const [hasStoredSig, setHasStoredSig] = useState(false);
  const [isPending, startTransition] = useTransition();

  // mount 時若有 60min 內的快取簽名 → 自動套用 + 預設「記住」也勾上
  useEffect(() => {
    if (mode !== "approve") return;
    const stored = readRememberedSig();
    if (stored && sigRef.current) {
      try {
        sigRef.current.fromDataURL(stored.dataUrl);
        setRemember(true);
        setHasStoredSig(true);
      } catch {
        // canvas 還沒 mount 完成 — 略過
      }
    }
  }, [mode]);

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
    setHasStoredSig(false);
  }

  function handleApprove() {
    if (sigRef.current?.isEmpty()) {
      toast.error(`請在下方簽名再${VERB[stage]}`);
      return;
    }
    const dataUrl = sigRef.current?.toDataURL("image/png");
    if (!dataUrl) {
      toast.error("簽名讀取失敗，請重試");
      return;
    }
    // 套用 remember 設定 — 勾選保留 60min,取消勾就清掉 cache
    if (remember) writeRememberedSig(dataUrl);
    else clearRememberedSig();

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
      // 加進度計數 — Phil 想知道「+1 / 還剩 N 份」
      const remaining = await getPendingCount(logId);
      toast.success(`已${VERB[stage]}`, {
        description:
          remaining > 0 ? `還剩 ${remaining} 份，跳下一份…` : "全部簽完了，辛苦您了",
      });
      await nextPendingRedirect(logId);
    });
  }

  function handleReject() {
    const finalComment = buildRejectComment();
    if (!finalComment) {
      toast.error("退回時請填寫原因");
      return;
    }
    startTransition(async () => {
      const res = await rejectStageAction({ logId, comment: finalComment });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const remaining = await getPendingCount(logId);
      toast.success("已退回", {
        description:
          remaining > 0 ? `還剩 ${remaining} 份，跳下一份…` : "全部處理完了",
      });
      await nextPendingRedirect(logId);
    });
  }

  return (
    <div className="rounded-lg border border-[#E0DCD6] bg-card p-5 md:p-6">
      <div className="mb-4 inline-flex rounded-md border border-[#E0DCD6] p-1">
        <button
          type="button"
          onClick={() => setMode("approve")}
          className={`inline-flex min-h-11 items-center rounded-sm px-5 text-sm transition-colors ${
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
          className={`inline-flex min-h-11 items-center rounded-sm px-5 text-sm transition-colors ${
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
              // 手機鍵盤彈出/網址列收合都算 window resize,預設會整張清空簽名
              clearOnResize={false}
              canvasProps={{
                className: "w-full",
                style: {
                  width: "100%",
                  // 響應式高度:橫向手機 / 矮螢幕用較小高度避免擠出畫面
                  height: "clamp(180px, 28vh, 260px)",
                  touchAction: "none",
                },
              }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="size-4 cursor-pointer accent-[#003153]"
              />
              <span>
                記住簽名（60 分鐘內）
                {hasStoredSig && (
                  <span className="ml-1 text-xs text-[#4A7C59]">
                    ✓ 已套用上次
                  </span>
                )}
              </span>
            </label>
            <button
              type="button"
              onClick={clearSig}
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-[#F5F1EC] hover:text-accent"
            >
              清除重簽
            </button>
          </div>

          <Textarea
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="備註（選填，例如：照片不錯、補充說明等）"
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

          {/* 已選 chip 列在 textarea 上方，點即可移除 */}
          {selectedChips.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5 rounded-md border border-[#E0DCD6] bg-[#FAF7F2] px-2 py-2">
              <span className="self-center text-xs text-muted-foreground">
                已選原因：
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
