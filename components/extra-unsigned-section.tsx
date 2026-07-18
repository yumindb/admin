"use client";

/**
 * 「未簽約」工項區塊 — 案件總覽頁面用。
 *
 * (注意:migration-2.16 後,「合約外」改用 ExtraContractsSection 以「合約」為單位呈現,
 *  不再走這個元件;這裡仍兼容 kind="extra" 的舊路徑,但實務上不再使用。)
 *
 * 對應 case_work_items.item_type='unsigned'。flat 結構,沒有階層。
 *
 * 功能:
 *  1. 顯示工項清單 + 累計完成進度
 *  2. office_staff/owner 可新增、編輯、刪除(複用 WorkItemEditModal,extraUnsignedKind="unsigned")
 *  3. 多選工項 → 一次打包成「追加合約」(2026-05-08 業主回饋 — 取代「逐筆標記簽約」)
 *  4. 仍保留「逐筆標記簽約」做為 fallback(只簽單筆 = 建一份單品項合約)
 *
 * 不在這裡:工地主任在 /logs/new 新增臨時項的入口(那邊另有自己的 add-button)。
 */

import { useMemo, useState, useTransition } from "react";
import { useBodyScrollLock, useEscToClose } from "@/lib/use-modal-behavior";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, FilePlus2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  WorkItemEditModal,
  type WorkItemEditTarget,
} from "@/components/work-item-edit-modal";
import { deleteWorkItemAction } from "@/app/(app)/cases/[id]/work-items-actions";
import { createExtraContractAction } from "@/app/(app)/cases/[id]/extra-contracts-actions";
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
  // 多選打包:勾選的工項 ids
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bundleDialogOpen, setBundleDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  // 站內刪除確認 modal 取代 window.confirm
  const [deleteTarget, setDeleteTarget] = useState<ExtraUnsignedRow | null>(null);

  const title = kind === "extra" ? "合約外項目（已簽約追加）" : "未簽約施工內容";
  const emptyHint =
    kind === "extra"
      ? "目前沒有合約外項目。簽約追加的工項會在這裡。"
      : "目前沒有未簽約施工內容。現場有臨時施工但尚未報價/簽約時，會在這裡列出。";
  const addLabel = kind === "extra" ? "新增合約外項目" : "新增未簽約項目";

  const selectedRows = useMemo(
    () => rows.filter((r) => selectedIds.has(r.id)),
    [rows, selectedIds],
  );

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function openCreate() {
    setModalMode("create");
    setModalTarget(undefined);
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
    setModalOpen(true);
  }

  function handleDelete(row: ExtraUnsignedRow) {
    setDeleteTarget(row);
  }

  function doDelete(row: ExtraUnsignedRow) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("work_item_id", row.id);
      const result = await deleteWorkItemAction(fd);
      if (!result.ok) {
        toast.error(result.error);
        setDeleteTarget(null);
        return;
      }
      if (result.warning) toast.warning(result.warning);
      else toast.success("已刪除");
      setDeleteTarget(null);
    });
  }

  function openBundle() {
    if (selectedIds.size === 0) {
      toast.warning("請先勾選要打包的工項");
      return;
    }
    setBundleDialogOpen(true);
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
                  已報價金額合計：
                  <span className="ml-1 tabular-nums text-foreground">
                    {totalQuoted.toLocaleString("zh-TW")}
                  </span>
                </span>
              )}
              {kind === "unsigned" && selectedIds.size > 0 && (
                <span className="ml-3 text-accent">
                  已勾 {selectedIds.size} 筆
                </span>
              )}
            </span>
          </h2>
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            {kind === "unsigned" && selectedIds.size > 0 && (
              <button
                type="button"
                onClick={openBundle}
                className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm text-white transition-colors hover:opacity-90"
              >
                <FilePlus2 className="size-4" /> 建立追加合約 ({selectedIds.size})
              </button>
            )}
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="size-4" /> {addLabel}
            </button>
          </div>
        )}
      </div>

      {kind === "unsigned" && rows.length > 0 && editable && (
        <p className="mb-3 text-sm text-muted-foreground">
          勾選多筆同時要追加的工項，按上方「建立追加合約」可一次打包成一份報價單（可填 bundle 優惠價）。
        </p>
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
                {kind === "unsigned" && editable && (
                  <th className="h-12 w-10 px-3 text-left text-sm font-medium tracking-wider whitespace-nowrap">
                    <input
                      type="checkbox"
                      aria-label="全選"
                      checked={
                        rows.length > 0 && selectedIds.size === rows.length
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(new Set(rows.map((r) => r.id)));
                        } else {
                          clearSelection();
                        }
                      }}
                      className="size-4 cursor-pointer accent-[#A07850]"
                    />
                  </th>
                )}
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
                    {kind === "unsigned" && editable && (
                      <td className="h-14 w-10 px-3 align-top">
                        <input
                          type="checkbox"
                          aria-label={`勾選 ${row.name}`}
                          checked={selectedIds.has(row.id)}
                          onChange={() => toggleSelected(row.id)}
                          className="size-4 cursor-pointer accent-[#A07850]"
                        />
                      </td>
                    )}
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
            toast.success(modalMode === "create" ? `已新增${title}` : "已更新");
          }}
          caseId={caseId}
          sectionOptions={[]}
          mode={modalMode}
          target={modalTarget}
          extraUnsignedKind={kind}
        />
      )}

      {/* 建立追加合約 dialog （kind='unsigned' 才會打開） */}
      {bundleDialogOpen && (
        <BundleContractDialog
          caseId={caseId}
          rows={selectedRows}
          onClose={() => setBundleDialogOpen(false)}
          onSaved={(name) => {
            setBundleDialogOpen(false);
            clearSelection();
            toast.success(`已建立追加合約「${name}」`, {
              description: "所選工項已轉到合約外",
            });
          }}
        />
      )}

      {/* 站內刪除確認 modal — 取代原本的 window.confirm */}
      {deleteTarget && (
        <ConfirmDialog
          open
          title={`刪除「${deleteTarget.name}」?`}
          description="此動作無法復原。歷史日誌如有引用此工項,進度紀錄仍會保留。"
          confirmText="確認刪除"
          danger
          pending={isPending}
          onConfirm={() => doDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

/* =================================================================
 * 多筆未簽約 → 一份追加合約 dialog
 * ================================================================= */
function BundleContractDialog({
  caseId,
  rows,
  onClose,
  onSaved,
}: {
  caseId: string;
  rows: ExtraUnsignedRow[];
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const itemsSum = rows.reduce(
    (s, r) => s + (r.totalPrice ?? 0),
    0,
  );
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  const [name, setName] = useState(`${today} 追加合約`);
  const [bundlePrice, setBundlePrice] = useState("");
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();
  // 鎖背景捲動 + ESC 關閉(pending 中不關)
  useBodyScrollLock(true);
  useEscToClose(true, onClose, !isPending);

  function submit() {
    if (!name.trim()) {
      toast.error("合約名稱必填");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("case_id", caseId);
      fd.set("name", name.trim());
      fd.set("bundle_price", bundlePrice.trim());
      fd.set("note", note.trim());
      // 帶 work_item_ids JSON,server action 會解析成多個 ids
      fd.set("work_item_ids", JSON.stringify(rows.map((r) => r.id)));
      const r = await createExtraContractAction(fd);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      onSaved(name.trim());
    });
  }

  const bundleNum = Number(bundlePrice);
  const showBundleDelta =
    bundlePrice.trim() && Number.isFinite(bundleNum) && itemsSum > 0;
  const bundleDelta = bundleNum - itemsSum;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl rounded-lg border border-[#E0DCD6] bg-card max-h-[90vh] overflow-hidden flex flex-col">
        <div className="border-b border-[#E0DCD6] px-5 py-3">
          <h3 className="text-base font-semibold text-primary">
            建立追加合約 — {rows.length} 筆工項
          </h3>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* 將被打包的工項清單 */}
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              將打包的工項
            </div>
            <ul className="rounded-md border border-[#E0DCD6] bg-[#FAF7F2] divide-y divide-[#E0DCD6]">
              {rows.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <span className="break-words font-medium">{r.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {r.unitPrice !== null
                      ? `${r.unitPrice.toLocaleString("zh-TW")}${r.quantity !== null ? ` × ${r.quantity}${r.unit ?? ""}` : ""} = ${(r.totalPrice ?? 0).toLocaleString("zh-TW")}`
                      : "未報價"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-1 text-right text-xs text-muted-foreground">
              工項複價加總：
              <span className="ml-1 tabular-nums text-foreground">
                {itemsSum.toLocaleString("zh-TW")}
              </span>
            </div>
          </div>

          <div className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              合約名稱<span className="ml-1 text-[#B91C1C]">*</span>
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="h-11 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            />
          </div>

          <div className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              bundle 優惠價（整份合約金額，可空）
            </span>
            <input
              type="number"
              step="any"
              value={bundlePrice}
              onChange={(e) => setBundlePrice(e.target.value)}
              placeholder="留空 = 用各品項複價加總"
              className="h-11 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            />
            {showBundleDelta && (
              <p className="mt-1 text-xs text-muted-foreground">
                {bundleDelta < 0
                  ? `相較工項加總，折讓 ${Math.abs(bundleDelta).toLocaleString("zh-TW")}`
                  : bundleDelta > 0
                    ? `相較工項加總，加價 ${bundleDelta.toLocaleString("zh-TW")}`
                    : "與工項加總相同（無折讓）"}
              </p>
            )}
          </div>

          <div className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              簽約備註
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="例：2026-05-08 LINE 同意追加，業主要求"
              className="w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            />
          </div>

        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#E0DCD6] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="inline-flex items-center rounded-md border border-[#E0DCD6] bg-white px-3 py-1.5 text-sm transition-colors hover:border-accent disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={isPending || !name.trim()}
            className="inline-flex items-center rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? "建立中…" : "確認建立合約"}
          </button>
        </div>
      </div>
    </div>
  );
}
