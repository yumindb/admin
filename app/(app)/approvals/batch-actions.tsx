"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SignatureCanvas from "react-signature-canvas";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { batchApproveAction } from "./[id]/actions";
import { uploadSignatureAction } from "../logs/[id]/photo-actions";
import { formatWeatherSummary } from "@/lib/daily-log";
import { formatDateTW } from "@/lib/datetime";
import type { ApprovalStage, DailyLog } from "@/lib/types";

type LogRow = DailyLog & {
  cases: { name: string; code: string | null } | null;
  profiles: { full_name: string } | null;
};

const VERB: Record<ApprovalStage, string> = {
  fill: "送出",
  review: "複核通過",
  audit: "審核通過",
  approve: "核定通過",
};

// 「記住本次簽名」的 localStorage key 與過期 TTL(60 分鐘)
const REMEMBER_KEY = "yumin-approval-sig-v1";
const REMEMBER_TTL_MS = 60 * 60 * 1000;

type RememberedSig = { dataUrl: string; savedAt: number };

function readRememberedSig(): RememberedSig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as RememberedSig;
    if (!obj?.dataUrl || !obj?.savedAt) return null;
    if (Date.now() - obj.savedAt > REMEMBER_TTL_MS) {
      window.localStorage.removeItem(REMEMBER_KEY);
      return null;
    }
    return obj;
  } catch {
    return null;
  }
}

function writeRememberedSig(dataUrl: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      REMEMBER_KEY,
      JSON.stringify({ dataUrl, savedAt: Date.now() } satisfies RememberedSig),
    );
  } catch {
    // quota exceeded — silently ignore
  }
}

function clearRememberedSig() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // ignore
  }
}

export function BatchApprovalsList({
  logs,
  stage,
}: {
  logs: LogRow[];
  stage: ApprovalStage;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [showModal, setShowModal] = useState(false);

  const allChecked = logs.length > 0 && selected.size === logs.length;
  const someChecked = selected.size > 0 && !allChecked;

  function toggleAll() {
    if (allChecked) {
      setSelected(new Set());
    } else {
      setSelected(new Set(logs.map((l) => l.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      {/* 全選 + 批簽工具列 */}
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-[#E0DCD6] bg-card px-3 py-2.5 md:px-4">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = someChecked;
            }}
            onChange={toggleAll}
            className="size-4 cursor-pointer accent-[#003153]"
            aria-label="全選"
          />
          <span>全選</span>
        </label>
        <span className="text-sm text-muted-foreground">
          已選 {selected.size} / {logs.length}
        </span>
        <Button
          type="button"
          disabled={selected.size === 0}
          onClick={() => setShowModal(true)}
          className="ml-auto bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-[#E0DCD6] disabled:text-muted-foreground"
        >
          批簽選取（{selected.size}）
        </Button>
      </div>

      <div className="space-y-3">
        {logs.map((l) => {
          const checked = selected.has(l.id);
          return (
            <div
              key={l.id}
              className={`group relative rounded-lg border bg-card transition-colors ${
                checked
                  ? "border-accent ring-1 ring-accent/40"
                  : "border-[#E0DCD6] hover:border-accent"
              }`}
            >
              <label className="absolute left-3 top-3 z-10 inline-flex cursor-pointer items-center md:left-4 md:top-4">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleOne(l.id)}
                  className="size-5 cursor-pointer accent-[#003153]"
                  aria-label={`勾選 ${l.cases?.name ?? "未命名案件"} ${l.log_date}`}
                />
              </label>
              <Link
                href={`/approvals/${l.id}`}
                className="block p-5 pl-12 md:p-6 md:pl-14"
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm text-muted-foreground">
                      {l.cases?.code ?? "未編號"}
                    </div>
                    <h3 className="text-lg font-semibold text-primary md:text-xl">
                      {l.cases?.name ?? "(已刪除案件)"}
                    </h3>
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    <div>{formatDateTW(l.log_date)}</div>
                    <div>{l.profiles?.full_name ?? "未知主任"}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
                  <span>{l.work_items?.length ?? 0} 個工項</span>
                  <span>{l.photos?.length ?? 0} 張照片</span>
                  {l.weather && <span>{formatWeatherSummary(l.weather)}</span>}
                </div>
              </Link>
            </div>
          );
        })}
      </div>

      {showModal && (
        <BatchApprovalModal
          logIds={Array.from(selected)}
          stage={stage}
          onClose={() => setShowModal(false)}
          onDone={(result) => {
            // 成功的清掉勾選,並 refresh server data
            if (result.ok.length > 0) {
              setSelected((prev) => {
                const next = new Set(prev);
                for (const id of result.ok) next.delete(id);
                return next;
              });
              router.refresh();
            }
          }}
        />
      )}
    </>
  );
}

function BatchApprovalModal({
  logIds,
  stage,
  onClose,
  onDone,
}: {
  logIds: string[];
  stage: ApprovalStage;
  onClose: () => void;
  onDone: (result: {
    ok: string[];
    failed: { logId: string; reason: string }[];
  }) => void;
}) {
  const sigRef = useRef<SignatureCanvas>(null);
  const [comment, setComment] = useState("");
  const [remember, setRemember] = useState(false);
  const [result, setResult] = useState<{
    ok: string[];
    failed: { logId: string; reason: string }[];
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  // 點開即還原(若 60 分鐘內有記住的簽名)
  useEffect(() => {
    const stored = readRememberedSig();
    if (stored && sigRef.current) {
      // SignatureCanvas 提供 fromDataURL
      try {
        sigRef.current.fromDataURL(stored.dataUrl);
        setRemember(true);
      } catch {
        // ignore
      }
    }
  }, []);

  function clearSig() {
    sigRef.current?.clear();
  }

  function submit() {
    if (sigRef.current?.isEmpty()) {
      toast.error("請先簽名");
      return;
    }
    const dataUrl = sigRef.current?.toDataURL("image/png");
    if (!dataUrl) {
      toast.error("簽名讀取失敗,請重試");
      return;
    }

    startTransition(async () => {
      // 1) 上傳簽名一次,拿 signed URL
      const fd = new FormData();
      fd.set("dataUrl", dataUrl);
      const upload = await uploadSignatureAction(fd);
      if (!upload.ok) {
        toast.error(upload.error);
        return;
      }
      // 2) 記住或清除暫存
      if (remember) writeRememberedSig(dataUrl);
      else clearRememberedSig();

      // 3) 批處理
      const res = await batchApproveAction({
        logIds,
        signatureUrl: upload.path,
        comment: comment.trim() || undefined,
      });
      setResult(res);
      onDone(res);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="批簽"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-t-lg bg-white p-5 shadow-xl md:rounded-lg md:p-6">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-primary md:text-xl">
            批簽 {logIds.length} 份
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label="關閉"
          >
            ×
          </button>
        </div>

        {!result ? (
          <>
            <p className="mb-2 text-sm text-muted-foreground">
              簽一次,套用到 {logIds.length} 份。每份各自寫一筆紀錄共用同張簽名。
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
                  style: {
                    width: "100%",
                    height: "260px",
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
                <span>下次簽核也用這個簽名(60 分鐘內)</span>
              </label>
              <button
                type="button"
                onClick={clearSig}
                disabled={isPending}
                className="text-xs text-muted-foreground hover:text-accent disabled:opacity-50"
              >
                清除重簽
              </button>
            </div>

            <textarea
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="備註(選填,所有勾選日誌共用)"
              className="mt-3 w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            />

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={onClose}
                className="border-[#E0DCD6]"
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={submit}
                disabled={isPending}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isPending ? "批簽中…" : `${VERB[stage]} ${logIds.length} 份`}
              </Button>
            </div>
          </>
        ) : (
          <BatchResultView
            result={result}
            stage={stage}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

function BatchResultView({
  result,
  stage,
  onClose,
}: {
  result: { ok: string[]; failed: { logId: string; reason: string }[] };
  stage: ApprovalStage;
  onClose: () => void;
}) {
  const verb = VERB[stage];
  return (
    <div>
      <div className="mb-3 rounded-md border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-2.5 text-sm text-[#4A7C59]">
        成功 {result.ok.length} 份{verb}。
        {result.failed.length > 0 && (
          <span className="ml-2 text-[#B91C1C]">
            失敗 {result.failed.length} 份。
          </span>
        )}
      </div>
      {result.failed.length > 0 && (
        <div className="mb-3 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-3 text-sm">
          <div className="mb-1.5 font-medium text-[#B91C1C]">失敗清單</div>
          <ul className="space-y-1">
            {result.failed.map((f) => (
              <li
                key={f.logId}
                className="flex flex-wrap items-center gap-x-2 text-[#B91C1C]"
              >
                <Link
                  href={`/approvals/${f.logId}`}
                  className="font-mono text-xs underline-offset-2 hover:underline"
                  title={f.logId}
                >
                  {f.logId.slice(0, 8)}…
                </Link>
                <span className="text-xs">— {f.reason}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            提示:狀態被他人變更通常是因為其他簽核者剛好同步處理。請重新整理列表後再試。
          </p>
        </div>
      )}
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={onClose}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          關閉
        </Button>
      </div>
    </div>
  );
}
