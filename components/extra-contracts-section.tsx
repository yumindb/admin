"use client";

/**
 * 「追加合約」區塊 — 案件總覽用。以「合約」為單位呈現,每張卡片包含:
 *   1. 合約 meta:名稱、簽約日期、bundle_price、備註
 *   2. 卡內工項:每筆品項自己的單價/數量/累計進度
 *   3. 操作:編輯合約欄位 / 拆解(退回未簽約)
 *
 * 不含「新增合約」按鈕 — 新增來自未簽約區塊的多選 bundle 動作
 * (見 ExtraUnsignedSection 的 bulk action)。
 *
 * 個別工項的編輯 / 刪除仍走 WorkItemEditModal(extraUnsignedKind="extra")。
 */

import { useState, useTransition } from "react";
import { useBodyScrollLock, useEscToClose } from "@/lib/use-modal-behavior";
import { toast } from "sonner";
import { Pencil, Unlink, ChevronDown, Pencil as PencilIcon, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  WorkItemEditModal,
  type WorkItemEditTarget,
} from "@/components/work-item-edit-modal";
import { deleteWorkItemAction } from "@/app/(app)/cases/[id]/work-items-actions";
import {
  updateExtraContractAction,
  unbundleExtraContractAction,
} from "@/app/(app)/cases/[id]/extra-contracts-actions";
import type { ProgressMap } from "@/components/work-items-tree";
import { formatDateTW } from "@/lib/datetime";

const PROGRESS_THRESHOLD = 0.001;

export type ContractWithItems = {
  id: string;
  name: string;
  bundlePrice: number | null;
  note: string | null;
  signedAt: string;
  items: ContractItem[];
};

export type ContractItem = {
  id: string;
  name: string;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  brandNote: string | null;
};

export function ExtraContractsSection({
  contracts,
  progress,
  caseId,
  editable,
}: {
  contracts: ContractWithItems[];
  progress: ProgressMap;
  caseId: string;
  editable: boolean;
}) {
  // 編輯個別工項 modal
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemModalTarget, setItemModalTarget] =
    useState<WorkItemEditTarget | undefined>(undefined);
  // 編輯合約 modal
  const [contractEditing, setContractEditing] = useState<ContractWithItems | null>(null);
  const [isPending, startTransition] = useTransition();
  // 確認對話框狀態（取代原本的 window.confirm）
  const [confirmTarget, setConfirmTarget] = useState<
    | { kind: "delete-item"; item: ContractItem }
    | { kind: "unbundle"; contract: ContractWithItems }
    | null
  >(null);

  function openItemEdit(item: ContractItem) {
    setItemModalTarget({
      id: item.id,
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      brandNote: item.brandNote,
      itemType: "extra",
    });
    setItemModalOpen(true);
  }

  function doDeleteItem(item: ContractItem) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("work_item_id", item.id);
      const r = await deleteWorkItemAction(fd);
      if (!r.ok) {
        toast.error(r.error);
      } else if (r.warning) {
        toast.warning(r.warning);
      } else {
        toast.success("已刪除");
      }
      setConfirmTarget(null);
    });
  }

  function doUnbundle(c: ContractWithItems) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("contract_id", c.id);
      const r = await unbundleExtraContractAction(fd);
      if (!r.ok) {
        toast.error(r.error);
      } else {
        toast.success("已拆解", { description: "工項已退回未簽約區" });
      }
      setConfirmTarget(null);
    });
  }

  const totalContractsValue = contracts.reduce((sum, c) => {
    if (c.bundlePrice !== null) return sum + c.bundlePrice;
    const itemsSum = c.items.reduce((s, it) => s + (it.totalPrice ?? 0), 0);
    return sum + itemsSum;
  }, 0);

  return (
    <div className="mt-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-primary md:text-xl">
          追加合約
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            共 {contracts.length} 份
            {totalContractsValue > 0 && (
              <span className="ml-3">
                合計金額：
                <span className="ml-1 tabular-nums text-foreground">
                  {totalContractsValue.toLocaleString("zh-TW")}
                </span>
              </span>
            )}
          </span>
        </h2>
      </div>

      {contracts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          目前沒有追加合約。從下方「未簽約」區塊勾選多筆工項，按「建立追加合約」即可打包成一份報價單。
        </div>
      ) : (
        <div className="space-y-4">
          {contracts.map((c) => (
            <ContractCard
              key={c.id}
              contract={c}
              progress={progress}
              editable={editable}
              onEdit={() => setContractEditing(c)}
              onUnbundle={() => setConfirmTarget({ kind: "unbundle", contract: c })}
              onItemEdit={openItemEdit}
              onItemDelete={(item) => setConfirmTarget({ kind: "delete-item", item })}
              isPending={isPending}
            />
          ))}
        </div>
      )}

      {editable && (
        <WorkItemEditModal
          open={itemModalOpen}
          onClose={() => setItemModalOpen(false)}
          onSaved={() => toast.success("已更新")}
          caseId={caseId}
          sectionOptions={[]}
          mode="edit"
          target={itemModalTarget}
          extraUnsignedKind="extra"
        />
      )}

      {editable && contractEditing && (
        <ContractEditModal
          contract={contractEditing}
          onClose={() => setContractEditing(null)}
          onSaved={() => setContractEditing(null)}
        />
      )}

      {/* 站內確認對話框：取代原本的 window.confirm。
          顯示影響範圍清單,讓辦公室助理有「拆解前先確認資料量」的視覺安心感。 */}
      {confirmTarget?.kind === "delete-item" && (
        <ConfirmDialog
          open
          title={`刪除「${confirmTarget.item.name}」?`}
          description="此動作無法復原。歷史日誌如有引用此工項,進度紀錄仍會保留。"
          confirmText="確認刪除"
          danger
          pending={isPending}
          onConfirm={() => doDeleteItem(confirmTarget.item)}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
      {confirmTarget?.kind === "unbundle" && (
        <ConfirmDialog
          open
          title={`拆解追加合約「${confirmTarget.contract.name}」?`}
          description="合約本身會刪除,合約內工項會退回到「未簽約」區。歷史日誌的進度仍會保留。"
          details={[
            {
              label: "合約內工項",
              value: `${confirmTarget.contract.items.length} 筆`,
            },
            {
              label: "合約金額",
              value:
                confirmTarget.contract.bundlePrice !== null
                  ? `${confirmTarget.contract.bundlePrice.toLocaleString("zh-TW")} 元`
                  : "未報價",
            },
            {
              label: "簽約日期",
              value: confirmTarget.contract.signedAt ?? "未簽",
            },
          ]}
          confirmText="確認拆解"
          danger
          pending={isPending}
          onConfirm={() => doUnbundle(confirmTarget.contract)}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </div>
  );
}

function ContractCard({
  contract,
  progress,
  editable,
  onEdit,
  onUnbundle,
  onItemEdit,
  onItemDelete,
  isPending,
}: {
  contract: ContractWithItems;
  progress: ProgressMap;
  editable: boolean;
  onEdit: () => void;
  onUnbundle: () => void;
  onItemEdit: (item: ContractItem) => void;
  onItemDelete: (item: ContractItem) => void;
  isPending: boolean;
}) {
  const itemsSum = contract.items.reduce(
    (s, it) => s + (it.totalPrice ?? 0),
    0,
  );
  const showBundleDelta =
    contract.bundlePrice !== null && itemsSum > 0 && contract.bundlePrice !== itemsSum;
  const bundleDelta = (contract.bundlePrice ?? 0) - itemsSum;

  return (
    <details
      open
      className="group/contract overflow-hidden rounded-lg border border-[#E0DCD6] bg-card"
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 border-b border-[#E0DCD6] bg-[#FAF7F2] px-5 py-3 [&::-webkit-details-marker]:hidden">
        <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open/contract:rotate-0 -rotate-90" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="break-words text-base font-semibold text-primary md:text-lg">
              {contract.name}
            </span>
            <span className="text-xs text-muted-foreground">
              簽約 {formatDateTW(contract.signedAt)} · {contract.items.length} 筆工項
            </span>
          </div>
          {contract.note && (
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {contract.note}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            {contract.bundlePrice !== null ? (
              <>
                <span>
                  bundle 優惠價：
                  <span className="ml-1 font-semibold tabular-nums text-foreground">
                    {contract.bundlePrice.toLocaleString("zh-TW")}
                  </span>
                </span>
                {showBundleDelta && (
                  <span className="text-xs text-muted-foreground">
                    （工項加總 {itemsSum.toLocaleString("zh-TW")},
                    {bundleDelta < 0 ? "折讓 " : "加價 "}
                    {Math.abs(bundleDelta).toLocaleString("zh-TW")})
                  </span>
                )}
              </>
            ) : itemsSum > 0 ? (
              <span>
                工項加總：
                <span className="ml-1 font-semibold tabular-nums text-foreground">
                  {itemsSum.toLocaleString("zh-TW")}
                </span>
                <span className="ml-1 text-xs text-muted-foreground">（未填 bundle 價）</span>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">未填單價</span>
            )}
          </div>
        </div>
        {editable && (
          <div
            className="flex shrink-0 items-center gap-1"
            onClick={(e) => e.preventDefault()} /* 點按鈕不要折疊 */
          >
            <button
              type="button"
              onClick={onEdit}
              title="編輯合約欄位"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white hover:text-accent"
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              onClick={onUnbundle}
              disabled={isPending}
              title="拆解合約 → 退回未簽約"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-[#FFFBEB] hover:text-[#92400E] disabled:opacity-50"
            >
              <Unlink className="size-4" />
            </button>
          </div>
        )}
      </summary>

      <div className="overflow-x-auto">
        <table className="min-w-full text-base">
          <thead>
            <tr className="bg-[#F5F1EC]">
              <th className="h-11 px-4 text-left text-sm font-medium tracking-wider min-w-[8rem]">名稱</th>
              <th className="h-11 px-4 text-left text-sm font-medium tracking-wider whitespace-nowrap">單位</th>
              <th className="h-11 px-4 text-right text-sm font-medium tracking-wider whitespace-nowrap">數量</th>
              <th className="h-11 px-4 text-right text-sm font-medium tracking-wider whitespace-nowrap">單價</th>
              <th className="h-11 px-4 text-right text-sm font-medium tracking-wider whitespace-nowrap">複價</th>
              <th className="h-11 px-4 text-right text-sm font-medium tracking-wider whitespace-nowrap">累計完成</th>
              {editable && (
                <th className="h-11 px-4 text-right text-sm font-medium tracking-wider whitespace-nowrap">操作</th>
              )}
            </tr>
          </thead>
          <tbody>
            {contract.items.map((item) => {
              const cumulative = progress.get(item.id) ?? 0;
              const ratio =
                item.quantity && item.quantity > 0 ? cumulative / item.quantity : null;
              const showProgress = cumulative > PROGRESS_THRESHOLD;
              const overShoot = ratio !== null && ratio > 1.0001;
              const completed = ratio !== null && ratio >= 1 - PROGRESS_THRESHOLD;
              return (
                <tr key={item.id} className="border-b border-[#E0DCD6] last:border-b-0">
                  <td className="h-14 px-4 align-top break-keep">
                    <div className="font-medium">{item.name}</div>
                    {item.brandNote && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {item.brandNote}
                      </div>
                    )}
                  </td>
                  <td className="h-14 px-4 align-top whitespace-nowrap">{item.unit ?? "—"}</td>
                  <td className="h-14 px-4 text-right align-top tabular-nums whitespace-nowrap">
                    {item.quantity ?? "—"}
                  </td>
                  <td className="h-14 px-4 text-right align-top tabular-nums whitespace-nowrap">
                    {item.unitPrice !== null
                      ? item.unitPrice.toLocaleString("zh-TW")
                      : "—"}
                  </td>
                  <td className="h-14 px-4 text-right align-top tabular-nums whitespace-nowrap">
                    {item.totalPrice !== null
                      ? item.totalPrice.toLocaleString("zh-TW")
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
                          : `${cumulative}${item.unit ?? ""}`}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {editable && (
                    <td className="h-14 px-4 text-right align-top">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onItemEdit(item)}
                          title="編輯品項"
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-[#F5F1EC] hover:text-accent"
                        >
                          <PencilIcon className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onItemDelete(item)}
                          disabled={isPending}
                          title="刪除品項"
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
    </details>
  );
}

/* =================================================================
 * 編輯合約欄位 modal — 名稱 / bundle_price / 備註
 * ================================================================= */
function ContractEditModal({
  contract,
  onClose,
  onSaved,
}: {
  contract: ContractWithItems;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(contract.name);
  const [bundlePrice, setBundlePrice] = useState(
    contract.bundlePrice !== null ? String(contract.bundlePrice) : "",
  );
  const [note, setNote] = useState(contract.note ?? "");
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
      fd.set("contract_id", contract.id);
      fd.set("name", name.trim());
      fd.set("bundle_price", bundlePrice.trim());
      fd.set("note", note.trim());
      const r = await updateExtraContractAction(fd);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("追加合約已更新");
      onSaved();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-y-auto overscroll-contain rounded-lg border border-[#E0DCD6] bg-card">
        <div className="border-b border-[#E0DCD6] px-5 py-3">
          <h3 className="text-base font-semibold text-primary">編輯追加合約</h3>
        </div>
        <div className="space-y-3 px-5 py-4">
          <Field label="合約名稱" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="h-11 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            />
          </Field>
          <Field label="bundle 優惠價（整份合約金額，可空）">
            <input
              type="number"
              step="any"
              value={bundlePrice}
              onChange={(e) => setBundlePrice(e.target.value)}
              placeholder="留空 = 用各品項複價加總"
              className="h-11 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            />
          </Field>
          <Field label="簽約備註">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="例：2026-05-08 LINE 同意追加"
              className="w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            />
          </Field>
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
            {isPending ? "儲存中…" : "儲存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-1 text-[#B91C1C]">*</span>}
      </span>
      {children}
    </label>
  );
}
