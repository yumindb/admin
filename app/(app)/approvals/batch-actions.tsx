"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SignatureCanvas from "react-signature-canvas";
import { useBodyScrollLock, useEscToClose } from "@/lib/use-modal-behavior";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  batchApproveAction,
  forceRejectStuckLogAction,
  forceDeleteStuckLogAction,
} from "./[id]/actions";
import { uploadSignatureAction } from "../logs/[id]/photo-actions";
import { formatWeatherSummary } from "@/lib/daily-log";
import { formatDateTW } from "@/lib/datetime";
import {
  clearRememberedSig,
  readRememberedSig,
  writeRememberedSig,
} from "@/lib/remembered-signature";
import type { ApprovalStage, DailyLog, UserRole } from "@/lib/types";

// 卡住日誌門檻(配 actions.ts FORCE_REJECT_MIN_DAYS / FORCE_DELETE_MIN_DAYS)
const STUCK_WARN_DAYS = 7;
const STUCK_DELETABLE_DAYS = 30;

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

// 「記住本次簽名」的 localStorage 已抽到 lib/remembered-signature.ts,
// approval-actions / new-log-form 都共用同一個 60-min cache。

type QuickFilter = "all" | "no_photos" | "no_items" | "stuck_7d";

export function BatchApprovalsList({
  logs,
  stage,
  role,
}: {
  logs: LogRow[];
  stage: ApprovalStage;
  role: UserRole;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [showModal, setShowModal] = useState(false);
  // 強制處理 modal:點到哪份日誌就跳出
  const [forceTarget, setForceTarget] = useState<LogRow | null>(null);
  // 辦公室助理視角:5+ 份時要能快速找「該補件的」
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");

  const canForceAction = role === "office_staff" || role === "owner";

  // 套搜尋(案件名 / 案號 / 主任)
  const q = search.trim().toLowerCase();
  const now = Date.now();
  const filteredLogs = logs.filter((l) => {
    if (q) {
      const hay = [l.cases?.name, l.cases?.code, l.profiles?.full_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (quickFilter === "no_photos" && (l.photos?.length ?? 0) > 0) return false;
    if (quickFilter === "no_items" && (l.work_items?.length ?? 0) > 0) return false;
    if (quickFilter === "stuck_7d") {
      if (!l.submitted_at) return false;
      const ageMs = now - new Date(l.submitted_at).getTime();
      if (ageMs < STUCK_WARN_DAYS * 24 * 60 * 60 * 1000) return false;
    }
    return true;
  });

  // 計算「等了 N 天」用,只算 submitted 後
  function daysSinceSubmit(l: LogRow): number | null {
    if (!l.submitted_at) return null;
    const ms = now - new Date(l.submitted_at).getTime();
    return Math.floor(ms / (24 * 60 * 60 * 1000));
  }

  const allChecked = filteredLogs.length > 0 && selected.size === filteredLogs.length;
  const someChecked = selected.size > 0 && !allChecked;

  function toggleAll() {
    if (allChecked) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredLogs.map((l) => l.id)));
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

  // 各 quick filter 對應的待簽數量
  const counts: Record<QuickFilter, number> = {
    all: logs.length,
    no_photos: logs.filter((l) => (l.photos?.length ?? 0) === 0).length,
    no_items: logs.filter((l) => (l.work_items?.length ?? 0) === 0).length,
    stuck_7d: logs.filter((l) => {
      const d = daysSinceSubmit(l);
      return d !== null && d >= STUCK_WARN_DAYS;
    }).length,
  };

  return (
    <>
      {/* 搜尋 + Quick filter chips */}
      <div className="mb-3 space-y-2 rounded-md border border-[#E0DCD6] bg-card px-3 py-2.5 md:px-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="案件名稱、案號、工地主任"
          className="h-11 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">快速篩選：</span>
          {(
            [
              ["all", "全部"],
              ["no_photos", "無照片"],
              ["no_items", "無工項"],
              ["stuck_7d", `卡 ≥ ${STUCK_WARN_DAYS} 天`],
            ] as [QuickFilter, string][]
          ).map(([key, label]) => {
            const active = quickFilter === key;
            const c = counts[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => setQuickFilter(key)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors ${
                  active
                    ? "border-accent bg-[#F5F1EC] text-primary"
                    : "border-[#E0DCD6] bg-white text-foreground hover:border-accent"
                } ${key !== "all" && c > 0 ? "font-medium" : ""}`}
              >
                <span>{label}</span>
                <span className="tabular-nums text-muted-foreground">{c}</span>
              </button>
            );
          })}
        </div>
      </div>

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
          已選 {selected.size} / {filteredLogs.length}
          {filteredLogs.length !== logs.length && (
            <span className="ml-1 text-muted-foreground">
              （共 {logs.length}）
            </span>
          )}
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

      {filteredLogs.length === 0 && (
        <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          沒有符合篩選的日誌。試試清除條件或切換 quick filter。
        </div>
      )}

      <div className="space-y-3">
        {filteredLogs.map((l) => {
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
                      {l.cases?.name ?? "（已刪除案件）"}
                    </h3>
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    <div>{formatDateTW(l.log_date)}</div>
                    <div>{l.profiles?.full_name ?? "未知主任"}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
                  <span>{l.work_items?.length ?? 0} 個工項</span>
                  <span
                    className={
                      (l.photos?.length ?? 0) === 0
                        ? "font-medium text-[#B91C1C]"
                        : ""
                    }
                  >
                    {l.photos?.length ?? 0} 張照片
                  </span>
                  {l.weather && <span>{formatWeatherSummary(l.weather)}</span>}
                  {(() => {
                    const d = daysSinceSubmit(l);
                    if (d === null || d < 1) return null;
                    const stuck = d >= STUCK_WARN_DAYS;
                    const urgent = d >= 2;
                    if (stuck) {
                      return (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#B91C1C] bg-[#B91C1C] px-2.5 py-0.5 text-xs font-semibold text-white">
                          🔥 卡 {d} 天
                        </span>
                      );
                    }
                    return (
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                          urgent
                            ? "border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]"
                            : "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]"
                        }`}
                      >
                        ⏱ 等 {d} 天
                      </span>
                    );
                  })()}
                </div>
              </Link>
              {(() => {
                const d = daysSinceSubmit(l);
                if (!canForceAction || d === null || d < STUCK_WARN_DAYS) return null;
                return (
                  <div className="border-t border-[#FCA5A5] bg-[#FEF2F2] px-5 py-2 md:px-6">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setForceTarget(l);
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#B91C1C] hover:underline"
                    >
                      🔥 卡 {d} 天 — 強制處理（退回 / 刪除）
                    </button>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {forceTarget && (
        <ForceActionModal
          log={forceTarget}
          stuckDays={daysSinceSubmit(forceTarget) ?? 0}
          onClose={() => setForceTarget(null)}
          onDone={() => {
            setForceTarget(null);
            router.refresh();
          }}
        />
      )}

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
  // 鎖背景捲動 + ESC 關閉(pending 中不關)
  useBodyScrollLock(true);
  useEscToClose(true, onClose, !isPending);

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
      toast.error("簽名讀取失敗，請重試");
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
      <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-t-lg bg-white p-5 shadow-xl md:rounded-lg md:p-6">
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
              簽一次，套用到 {logIds.length} 份。每份各自寫一筆紀錄共用同張簽名。
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
                <span>下次簽核也用這個簽名（60 分鐘內）</span>
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

            <Textarea
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="備註（選填，所有勾選日誌共用）"
              className="mt-3"
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
                size="xl"
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
            提示：狀態被他人變更通常是因為其他簽核者剛好同步處理。請重新整理列表後再試。
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

/**
 * 卡住日誌強制處理 modal:
 *   - 卡 ≥ 7 天:可「強制退回填表人」(寫原因,日誌回到 draft 讓填表人重整 / 刪除)
 *   - 卡 ≥ 30 天:另開「直接刪除」(極端情況,audit trigger 留證)
 * 兩個動作都要求二次確認,避免誤刪。
 */
function ForceActionModal({
  log,
  stuckDays,
  onClose,
  onDone,
}: {
  log: LogRow;
  stuckDays: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"reject" | "delete">("reject");
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [isPending, startTransition] = useTransition();
  // 鎖背景捲動 + ESC 關閉(pending 中不關)
  useBodyScrollLock(true);
  useEscToClose(true, onClose, !isPending);
  const canDelete = stuckDays >= STUCK_DELETABLE_DAYS;
  const caseLabel = log.cases?.name ?? "（未命名案件）";
  const dateLabel = formatDateTW(log.log_date);

  function submit() {
    startTransition(async () => {
      if (mode === "reject") {
        const r = await forceRejectStuckLogAction({
          logId: log.id,
          comment: reason.trim(),
        });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success("已強制退回填表人");
        onDone();
      } else {
        if (confirmText.trim() !== "刪除") {
          toast.error("請輸入「刪除」二字確認");
          return;
        }
        const r = await forceDeleteStuckLogAction({ logId: log.id });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success("已刪除日誌（已留 audit 紀錄）");
        onDone();
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="強制處理卡住日誌"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose();
      }}
    >
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-lg bg-white p-5 shadow-xl md:rounded-lg md:p-6">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-primary md:text-xl">
            強制處理（卡 {stuckDays} 天）
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

        <div className="mb-4 rounded-md border border-[#E0DCD6] bg-[#FAF7F2] px-3 py-2 text-sm">
          <div className="font-medium text-primary">{caseLabel}</div>
          <div className="text-muted-foreground">
            {dateLabel} · {log.profiles?.full_name ?? "未知填表人"}
          </div>
        </div>

        <div
          role="tablist"
          aria-label="處理方式"
          className="mb-4 inline-flex w-full rounded-md border border-[#E0DCD6] bg-card p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "reject"}
            onClick={() => setMode("reject")}
            className={`flex-1 rounded-[5px] px-3 py-1.5 text-sm font-medium ${
              mode === "reject"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-[#F5F1EC]"
            }`}
          >
            退回填表人
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "delete"}
            onClick={() => canDelete && setMode("delete")}
            disabled={!canDelete}
            title={
              canDelete
                ? "整份刪除(留 audit 紀錄)"
                : `卡 ≥ ${STUCK_DELETABLE_DAYS} 天才能刪除`
            }
            className={`flex-1 rounded-[5px] px-3 py-1.5 text-sm font-medium ${
              mode === "delete"
                ? "bg-[#B91C1C] text-white shadow-sm"
                : "text-muted-foreground hover:bg-[#F5F1EC]"
            } ${!canDelete ? "cursor-not-allowed opacity-50" : ""}`}
          >
            刪除整份
          </button>
        </div>

        {mode === "reject" ? (
          <>
            <p className="mb-2 text-sm text-muted-foreground">
              日誌會退回成「草稿」狀態，填表人可以重整或自行刪除。會留一筆退回紀錄。
            </p>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="退回原因（必填，例：超過 7 天未處理，請填表人確認後重送）"
              className="mb-4"
            />
            <div className="flex flex-wrap justify-end gap-2">
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
                disabled={isPending || !reason.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isPending ? "處理中…" : "強制退回"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2.5 text-sm text-[#B91C1C]">
              ⚠ 此動作會 <strong>永久刪除整份日誌</strong>（含照片、簽名、簽核紀錄）。
              系統會在 audit_logs 留下完整紀錄（誰、何時、刪了什麼）。
              一般情況請選「退回填表人」。
            </div>
            <p className="mb-2 text-sm text-muted-foreground">
              請輸入「<strong>刪除</strong>」二字確認：
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="刪除"
              className="mb-4 h-11 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-base outline-none focus-visible:border-[#B91C1C] focus-visible:ring-2 focus-visible:ring-[#FCA5A5]"
            />
            <div className="flex flex-wrap justify-end gap-2">
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
                disabled={isPending || confirmText.trim() !== "刪除"}
                className="bg-[#B91C1C] text-white hover:bg-[#991B1B]"
              >
                {isPending ? "刪除中…" : "確認刪除"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
