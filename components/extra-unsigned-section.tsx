"use client";

/**
 * 合約外 / 未簽約 工項 — 案件總覽頁面用。
 *
 * 對應 case_work_items.item_type IN ('extra','unsigned')。flat 結構,沒有階層。
 *
 * 三件功能:
 *  1. 顯示工項清單 + 累計完成進度(用同一個 ProgressMap)
 *  2. office_staff/owner 可新增、編輯、刪除(複用 WorkItemEditModal,extraUnsignedKind 模式)
 *  3. 未簽約專屬:office_staff/owner 可「標記為已簽約」→ 變成合約外項目
 *
 * 不在這裡:工地主任在 /logs/new 新增臨時項的入口(那邊另有自己的 add-button)。
 */

import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2, BadgeCheck } from "lucide-react";
import {
  WorkItemEditModal,
  type WorkItemEditTarget,
} from "@/components/work-item-edit-modal";
import {
  deleteWorkItemAction,
  markUnsignedAsSignedAction,
} from "@/app/(app)/cases/[id]/work-items-actions";
import { formatDateTW } from "@/lib/datetime";
import type { ProgressMap } from "@/components/work-items-tree";

export type ExtraUnsignedRow = {
  id: string;
  name: string;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  brandNote: string | null;
  itemType: "extra" | "unsigned";
  quoteStatus: "pending" | "quoted" | null;
  contractSignedAt: string | null;
  contractNote: string | null;
};

const PROGRESS_THRESHOLD = 0.001;

export function ExtraUnsignedSection({
  kind,
  rows,
  progress,
  caseId,
  editable,
}: {
  kind: "extra" | "unsigned";
  rows: ExtraUnsignedRow[];
  progress: ProgressMap;
  caseId: string;
  editable: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [modalTarget, setModalTarget] = useState<WorkItemEditTarget | undefined>(
    undefined,
  );
  const [signTarget, setSignTarget] = useState<ExtraUnsignedRow | null>(null);
  const [signNote, setSignNote] = useState("");
  const [feedback, setFeedback] = useState<
    | { tone: "info" | "warn" | "error"; msg: string }
    | null
  >(null);
  const [isPending, startTransition] = useTransition();

  const title = kind === "extra" ? "合約外項目（已簽約追加）" : "未簽約施工內容";
  const emptyHint =
    kind === "extra"
      ? "目前沒有合約外項目。簽約追加的工項會在這裡。"
      : "目前沒有未簽約施工內容。現場有臨時施工但尚未報價/簽約時,會在這裡列出。";
  const addLabel = kind === "extra" ? "新增合約外項目" : "新增未簽約項目";

  function openCreate() {
    setModalMode("create");
    setModalTarget(undefined);
    setFeedback(null);
    setModalOpen(true);
  }

  function openEdit(row: ExtraUnsignedRow) {
    setModalMode("edit");
    setModalTarget({
      id: row.id,
      name: row.name,
      unit: row.unit,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      brandNote: row.brandNote,
      itemType: row.itemType,
    });
    setFeedback(null);
    setModalOpen(true);
  }

  function handleDelete(row: ExtraUnsignedRow) {
    if (!confirm(`確定刪除「${row.name}」嗎?此動作無法復原。`)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("work_item_id", row.id);
      const result = await deleteWorkItemAction(fd);
      if (!result.ok) {
        setFeedback({ tone: "error", msg: result.error });
        return;
      }
      setFeedback({
        tone: result.warning ? "warn" : "info",
        msg: result.warning ?? "已刪除",
      });
    });
  }

  function openSign(row: ExtraUnsignedRow) {
    if (row.unitPrice === null) {
      setFeedback({
        tone: "warn",
        msg: "請先編輯此工項補上單價(報價),才能標記為已簽約。",
      });
      return;
    }
    setSignTarget(row);
    setSignNote("");
    setFeedback(null);
  }

  function submitSign() {
    if (!signTarget) return;
    if (!signNote.trim()) {
      setFeedback({ tone: "error", msg: "簽約備註必填(例如:「2026-05-08 LINE 同意追加」)" });
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("work_item_id", signTarget.id);
      fd.set("contract_note", signNote.trim());
      const result = await markUnsignedAsSignedAction(fd);
      if (!result.ok) {
        setFeedback({ tone: "error", msg: result.error });
        return;
      }
      setFeedback({ tone: "info", msg: "已標記為合約外(已簽約追加)" });
      setSignTarget(null);
    });
  }

  const totalQuoted = rows.reduce(
    (sum, r) => (r.totalPrice !== null ? sum + r.totalPrice : sum),
    0,
  );

  return (
    <div className="mt-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-primary md:text-xl">
            {title}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              共 {rows.length} 筆
              {totalQuoted > 0 && (
                <span className="ml-3">
                  已報價金額合計:
                  <span className="ml-1 tabular-nums text-foreground">
                    {totalQuoted.toLocaleString("zh-TW")}
                  </span>
                </span>
              )}
            </span>
          </h2>
        </div>
        {editable && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="size-4" /> {addLabel}
          </button>
        )}
      </div>

      {feedback && (
        <div
          className={`mb-3 rounded-md border px-3 py-2 text-sm ${
            feedback.tone === "error"
              ? "border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]"
              : feedback.tone === "warn"
                ? "border-[#FCD34D] bg-[#FFFBEB] text-[#92400E]"
                : "border-[#A7F3D0] bg-[#ECFDF5] text-[#4A7C59]"
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          {emptyHint}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#E0DCD6] bg-card">
          <table className="min-w-full text-base">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                <th className="h-12 px-4 text-left text-sm font-medium tracking-wider min-w-[8rem]">名稱</th>
                <th className="h-12 px-4 text-left text-sm font-medium tracking-wider min-w-[3.5rem] whitespace-nowrap">單位</th>
                <th className="h-12 px-4 text-right text-sm font-medium tracking-wider min-w-[4rem] whitespace-nowrap">數量</th>
                <th className="h-12 px-4 text-right text-sm font-medium tracking-wider min-w-[4.5rem] whitespace-nowrap">單價</th>
                <th className="h-12 px-4 text-right text-sm font-medium tracking-wider min-w-[4.5rem] whitespace-nowrap">複價</th>
                <th className="h-12 px-4 text-right text-sm font-medium tracking-wider min-w-[5rem] whitespace-nowrap">累計完成</th>
                <th className="h-12 px-4 text-left text-sm font-medium tracking-wider min-w-[4.5rem] whitespace-nowrap">狀態</th>
                {editable && (
                  <th className="h-12 px-4 text-right text-sm font-medium tracking-wider min-w-[6rem] whitespace-nowrap">操作</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cumulative = progress.get(row.id) ?? 0;
                const ratio =
                  row.quantity && row.quantity > 0 ? cumulative / row.quantity : null;
                const showProgress = cumulative > PROGRESS_THRESHOLD;
                const overShoot = ratio !== null && ratio > 1.0001;
                const completed = ratio !== null && ratio >= 1 - PROGRESS_THRESHOLD;
                return (
                  <tr key={row.id} className="border-b border-[#E0DCD6]">
                    <td className="h-14 px-4 align-top min-w-[8rem] break-keep">
                      <div className="font-medium">{row.name}</div>
                      {row.brandNote && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {row.brandNote}
                        </div>
                      )}
                      {row.contractSignedAt && (
                        <div className="mt-1 text-xs text-[#4A7C59]">
                          已簽約 {formatDateTW(row.contractSignedAt)}
                          {row.contractNote && (
                            <span className="ml-1 text-muted-foreground">
                              ・{row.contractNote}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="h-14 px-4 align-top whitespace-nowrap">{row.unit ?? "—"}</td>
                    <td className="h-14 px-4 text-right align-top tabular-nums whitespace-nowrap">
                      {row.quantity ?? "—"}
                    </td>
                    <td className="h-14 px-4 text-right align-top tabular-nums whitespace-nowrap">
                      {row.unitPrice !== null
                        ? row.unitPrice.toLocaleString("zh-TW")
                        : "—"}
                    </td>
                    <td className="h-14 px-4 text-right align-top tabular-nums whitespace-nowrap">
                      {row.totalPrice !== null
                        ? row.totalPrice.toLocaleString("zh-TW")
                        : "—"}
                    </td>
                    <td className="h-14 px-4 text-right align-top tabular-nums whitespace-nowrap">
                      {showProgress ? (
                        <span
                          className={
                            overShoot
                              ? "text-accent"
                              : completed
                                ? "text-[#4A7C59]"
                                : "text-foreground"
                          }
                        >
                          {ratio !== null
                            ? `${(ratio * 100).toFixed(0)}%`
                            : `${cumulative}${row.unit ?? ""}`}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="h-14 px-4 align-top whitespace-nowrap">
                      {row.itemType === "unsigned" ? (
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                            row.quoteStatus === "quoted"
                              ? "bg-[#ECFDF5] text-[#4A7C59]"
                              : "bg-[#FFFBEB] text-[#92400E]"
                          }`}
                        >
                          {row.quoteStatus === "quoted" ? "已報價" : "待報價"}
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-[#ECFDF5] px-2 py-0.5 text-xs text-[#4A7C59]">
                          已簽約
                        </span>
                      )}
                    </td>
                    {editable && (
                      <td className="h-14 px-4 text-right align-top">
                        <div className="inline-flex items-center gap-1">
                          {row.itemType === "unsigned" && (
                            <button
                              type="button"
                              onClick={() => openSign(row)}
                              disabled={isPending}
                              title="標記為已簽約 → 移到合約外項目"
                              className="inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-white px-2 py-1 text-xs text-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                            >
                              <BadgeCheck className="size-3.5" /> 標記簽約
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            title="編輯"
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-[#F5F1EC] hover:text-accent"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(row)}
                            disabled={isPending}
                            title="刪除"
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-[#FEF2F2] hover:text-[#B91C1C] disabled:opacity-50"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editable && (
        <WorkItemEditModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setFeedback({
              tone: "info",
              msg: modalMode === "create" ? `已新增${title}` : "已更新",
            });
          }}
          caseId={caseId}
          sectionOptions={[]}
          mode={modalMode}
          target={modalTarget}
          extraUnsignedKind={kind}
        />
      )}

      {/* 標記簽約 dialog (僅 unsigned) */}
      {signTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-lg border border-[#E0DCD6] bg-card">
            <div className="border-b border-[#E0DCD6] px-5 py-3">
              <h3 className="text-base font-semibold text-primary">標記為已簽約</h3>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="rounded-md border border-[#E0DCD6] bg-[#FAF7F2] p-3 text-sm">
                <div className="font-medium">{signTarget.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  單價 {signTarget.unitPrice?.toLocaleString("zh-TW")}
                  {signTarget.quantity !== null &&
                    ` × ${signTarget.quantity}${signTarget.unit ?? ""}`}
                  {signTarget.totalPrice !== null &&
                    ` = ${signTarget.totalPrice.toLocaleString("zh-TW")}`}
                </div>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  簽約備註<span className="ml-1 text-[#B91C1C]">*</span>
                </span>
                <textarea
                  value={signNote}
                  onChange={(e) => setSignNote(e.target.value)}
                  placeholder="例如:2026-05-08 LINE 同意追加"
                  rows={2}
                  className="w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  簽約後會移到「合約外項目」並記錄此備註與時間。
                </p>
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[#E0DCD6] px-5 py-3">
              <button
                type="button"
                onClick={() => setSignTarget(null)}
                disabled={isPending}
                className="inline-flex items-center rounded-md border border-[#E0DCD6] bg-white px-3 py-1.5 text-sm transition-colors hover:border-accent disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={submitSign}
                disabled={isPending || !signNote.trim()}
                className="inline-flex items-center rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isPending ? "處理中…" : "確認簽約"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
