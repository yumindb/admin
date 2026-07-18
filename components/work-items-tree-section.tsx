"use client";

/**
 * 工項清單(case detail 頁) — 包 WorkItemsTree 加上搜尋、篩選 pills、展開/收合按鈕。
 *
 * filter pills 是「多選 toggle」:
 *   - 全部:點下去清空其他選項
 *   - 已勾(已有日誌進度):done > 0
 *   - 100%+:超量(累計 / 契約 > 1)
 * 「未勾」不在這裡(那是日誌新建表單情境,picker 用)。
 *
 * editable=true 時(office_staff / owner):
 *   - 標題列右側顯示「+ 新增工項」按鈕
 *   - tree 每列 hover 顯示「編輯」「刪除」「+ 加子項」icon
 *   - 開啟共用 WorkItemEditModal 處理新增 / 編輯
 *   - 刪除走站內 ConfirmDialog; server action 內統計 dangling 後仍回 ok 但帶 warning
 */

import { useMemo, useState, useTransition } from "react";
import { Search, ChevronsUpDown, ChevronsDownUp, Plus } from "lucide-react";
import {
  WorkItemsTree,
  type ProgressMap,
  type TreeFilterMode,
  type TreeItem,
} from "@/components/work-items-tree";
import {
  WorkItemEditModal,
  type SectionOption,
  type WorkItemEditTarget,
} from "@/components/work-item-edit-modal";
import { deleteWorkItemAction } from "@/app/(app)/cases/[id]/work-items-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const PILLS: { key: TreeFilterMode; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "completed", label: "有進度" },
  { key: "over100", label: "100%+" },
];

export function WorkItemsTreeSection({
  items,
  progress,
  caseId,
  editable = false,
}: {
  items: TreeItem[];
  progress: ProgressMap;
  caseId?: string;
  editable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [modes, setModes] = useState<Set<TreeFilterMode>>(
    () => new Set<TreeFilterMode>(["all"]),
  );
  const [expandSignal, setExpandSignal] = useState(0);
  const [collapseSignal, setCollapseSignal] = useState(0);

  // modal 狀態
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [modalParentId, setModalParentId] = useState<string | null>(null);
  const [modalTarget, setModalTarget] = useState<
    WorkItemEditTarget | undefined
  >(undefined);

  const [feedback, setFeedback] = useState<
    | { tone: "info" | "warn" | "error"; msg: string }
    | null
  >(null);
  const [deletePending, startDelete] = useTransition();
  // 站內 ConfirmDialog 取代原生 confirm()(手機樣式突兀、\n 不換行、放不下細節)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    label: string;
    isSection: boolean;
  } | null>(null);

  function togglePill(k: TreeFilterMode) {
    setModes((prev) => {
      const n = new Set(prev);
      if (k === "all") {
        return new Set<TreeFilterMode>(["all"]);
      }
      n.delete("all");
      if (n.has(k)) n.delete(k);
      else n.add(k);
      if (n.size === 0) n.add("all");
      return n;
    });
  }

  // 工項總數(僅 leaf — item / spec / manual)
  const leafCount = useMemo(
    () => items.filter((x) => x.itemType !== "section").length,
    [items],
  );

  // 提供 modal 用的 parent options — 僅 section 可當 parent (item / spec 不適合掛 manual)
  const sectionOptions: SectionOption[] = useMemo(
    () =>
      items
        .filter((x) => x.itemType === "section")
        .map((x) => ({
          id: x.id,
          label: x.tenderCode ? `${x.tenderCode}  ${x.name}` : x.name,
          depth: x.depth,
        })),
    [items],
  );

  const itemsById = useMemo(() => {
    const m = new Map<string, TreeItem>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  function openCreate(parentId: string | null) {
    if (!editable || !caseId) return;
    setModalMode("create");
    setModalParentId(parentId);
    setModalTarget(undefined);
    setFeedback(null);
    setModalOpen(true);
  }

  function openEdit(id: string) {
    if (!editable || !caseId) return;
    const it = itemsById.get(id);
    if (!it) return;
    if (it.itemType === "section") {
      setFeedback({
        tone: "warn",
        msg: "分類層不可直接編輯，請改透過匯入流程處理。",
      });
      return;
    }
    setModalMode("edit");
    setModalTarget({
      id: it.id,
      name: it.name,
      unit: it.unit,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      brandNote: it.brandNote,
      itemType: it.itemType,
      parentId: it.parentId,
    });
    setFeedback(null);
    setModalOpen(true);
  }

  function handleDelete(id: string) {
    if (!editable || !caseId) return;
    const it = itemsById.get(id);
    if (!it) return;
    const label = it.tenderCode ? `${it.tenderCode}  ${it.name}` : it.name;
    setDeleteTarget({ id, label, isSection: it.itemType === "section" });
  }

  function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    startDelete(async () => {
      const fd = new FormData();
      fd.set("work_item_id", target.id);
      const result = await deleteWorkItemAction(fd);
      setDeleteTarget(null);
      if (!result.ok) {
        setFeedback({ tone: "error", msg: result.error });
        return;
      }
      if (result.warning) {
        setFeedback({ tone: "warn", msg: result.warning });
      } else {
        setFeedback({ tone: "info", msg: "已刪除" });
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`搜尋 ${leafCount} 個工項`}
            className="h-11 w-full rounded-md border border-[#E0DCD6] bg-white pl-9 pr-3 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PILLS.map((p) => {
            const active = modes.has(p.key);
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => togglePill(p.key)}
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-[#E0DCD6] bg-white text-foreground hover:border-accent"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExpandSignal((n) => n + 1)}
            className="inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-white px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-accent hover:text-accent"
            title="展開全部"
          >
            <ChevronsUpDown className="size-3.5" /> 展開
          </button>
          <button
            type="button"
            onClick={() => setCollapseSignal((n) => n + 1)}
            className="inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-white px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-accent hover:text-accent"
            title="收合全部"
          >
            <ChevronsDownUp className="size-3.5" /> 收合
          </button>
          {editable && caseId && (
            <button
              type="button"
              onClick={() => openCreate(null)}
              className="ml-1 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
              title="新增工項"
            >
              <Plus className="size-3.5" /> 新增工項
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
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

      <WorkItemsTree
        items={items}
        progress={progress}
        query={query}
        filterModes={modes}
        expandAllSignal={expandSignal || undefined}
        collapseAllSignal={collapseSignal || undefined}
        editable={editable && !!caseId}
        onEdit={editable && caseId ? openEdit : undefined}
        onDelete={editable && caseId ? handleDelete : undefined}
        onAdd={editable && caseId ? openCreate : undefined}
      />

      {editable && caseId && (
        <WorkItemEditModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSaved={(result) => {
            if (result.ok && result.warning) {
              setFeedback({ tone: "warn", msg: result.warning });
            } else if (result.ok) {
              setFeedback({
                tone: "info",
                msg: modalMode === "create" ? "已新增工項" : "已更新工項",
              });
            }
          }}
          caseId={caseId}
          sectionOptions={sectionOptions}
          mode={modalMode}
          initialParentId={modalParentId}
          target={modalTarget}
        />
      )}

      {editable && caseId && (
        <ConfirmDialog
          open={deleteTarget !== null}
          title={
            deleteTarget?.isSection
              ? `刪除分類「${deleteTarget.label}」？`
              : `刪除「${deleteTarget?.label ?? ""}」？`
          }
          description={
            deleteTarget?.isSection
              ? "此分類下的所有子工項與細項會一併刪除。此動作無法復原。"
              : "此動作無法復原。已在日誌填過的進度紀錄會保留，但會失去對應工項。"
          }
          confirmText="確認刪除"
          danger
          pending={deletePending}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
