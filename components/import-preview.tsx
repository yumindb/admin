"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { WorkItemsTree, type TreeItem } from "@/components/work-items-tree";
import {
  parseTenderArrayBuffer,
  flattenTree,
  type ParsedNode,
  type ParseResult,
} from "@/lib/tender-parser";
import { confirmImportAction } from "@/app/(app)/cases/[id]/import/actions";

type ParsedState = ParseResult & { sheetName: string; fileName: string };

export function ImportPreview({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [parsed, setParsed] = useState<ParsedState | null>(null);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  const [parseError, setParseError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  async function onFileChange(file: File | null) {
    setParseError(null);
    setParsed(null);
    setSkippedIds(new Set());
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const result = parseTenderArrayBuffer(buf);
      setParsed({ ...result, fileName: file.name });
    } catch (err) {
      setParseError("讀取失敗：" + (err as Error).message);
    }
  }

  function toggleSkip(id: string, next: boolean) {
    setSkippedIds((prev) => {
      const n = new Set(prev);
      // 連動：勾／取消任一節點時，同步處理所有子孫
      const flat = parsed ? flattenTree(parsed.tree) : [];
      const childrenByParent = new Map<string, string[]>();
      for (const node of flat) {
        if (!node.parentId) continue;
        const arr = childrenByParent.get(node.parentId) ?? [];
        arr.push(node.id);
        childrenByParent.set(node.parentId, arr);
      }
      const targets = new Set<string>([id]);
      const queue = [id];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const c of childrenByParent.get(cur) ?? []) {
          if (!targets.has(c)) {
            targets.add(c);
            queue.push(c);
          }
        }
      }
      for (const t of targets) {
        if (next) n.add(t);
        else n.delete(t);
      }
      return n;
    });
  }

  function onConfirm() {
    if (!parsed) return;
    const flat = flattenTree(parsed.tree);
    const nodes = flat.map((n: ParsedNode) => ({
      id: n.id,
      depth: n.depth,
      sortPath: n.sortPath,
      parentId: n.parentId,
      type: n.type,
      tenderCode: n.tenderCode,
      name: n.name,
      unit: n.unit,
      quantity: n.quantity,
      unitPrice: n.unitPrice,
      totalPrice: n.totalPrice,
      brandNote: n.brandNote,
      specText: n.specText,
      skippedByUser: skippedIds.has(n.id),
    }));

    startTransition(async () => {
      const res = await confirmImportAction({
        caseId,
        fileName: parsed.fileName,
        nodes,
        stats: parsed.stats,
        warnings: parsed.warnings,
      });
      if (!res.ok) {
        setSubmitMsg("匯入失敗：" + res.error);
      } else {
        const total = (res.importedCount ?? 0) + (res.updatedCount ?? 0);
        setSubmitMsg(
          `匯入完成：新增/更新 ${total} 項，略過 ${res.skippedFromUI ?? 0} 項`
        );
        // 給 user 看 1 秒結果再跳走
        setTimeout(() => router.push(`/cases/${caseId}`), 800);
      }
    });
  }

  // 把 tree 攤平成 TreeItem[]（含 user-skipped 狀態）
  const treeItems: TreeItem[] = parsed
    ? flattenTree(parsed.tree).map((n) => ({
        id: n.id,
        parentId: n.parentId,
        depth: n.depth,
        itemType: n.type === "skip" ? "manual" : n.type,
        tenderCode: n.tenderCode,
        name: n.name,
        unit: n.unit,
        quantity: n.quantity,
        unitPrice: n.unitPrice,
        totalPrice: n.totalPrice,
        brandNote: n.brandNote,
        specText: n.specText,
        skipped: skippedIds.has(n.id),
      }))
    : [];

  return (
    <div className="space-y-6">
      {/* Step 1: 上傳檔案 */}
      <div className="rounded-lg border border-[#E0DCD6] bg-card p-6 md:p-7">
        <div className="mb-2 text-base font-semibold text-primary md:text-lg">1. 選擇標單檔</div>
        <p className="mb-4 text-xs text-muted-foreground">
          支援 .xlsx 格式（裕民工務 7 欄標單模板）。檔案不會上傳到伺服器，瀏覽器先解析、確認後才寫入資料庫。
        </p>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          className="block w-full rounded-md border border-[#E0DCD6] bg-white p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
        />
        {parseError && (
          <p className="mt-3 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
            {parseError}
          </p>
        )}
      </div>

      {parsed && (
        <>
          {/* Step 2: 預覽 */}
          <div className="rounded-lg border border-[#E0DCD6] bg-card p-6 md:p-7">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-primary">2. 預覽工項</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {parsed.fileName} · {parsed.sheetName} · 共 {parsed.stats.rows} 列
                </p>
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <Stat label="分類" v={parsed.stats.sections} />
                <Stat label="工項" v={parsed.stats.items} />
                <Stat label="規格" v={parsed.stats.specs} />
                <Stat label="忽略" v={parsed.stats.skipped} />
              </div>
            </div>

            {parsed.warnings.length > 0 && (
              <div className="mb-3 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs text-[#92400E]">
                <strong>{parsed.warnings.length}</strong> 個解析警告（可確認後仍匯入；範例：第{" "}
                {parsed.warnings.slice(0, 3).map((w) => w.row).join(", ")} 列）
              </div>
            )}

            <WorkItemsTree
              items={treeItems}
              showSkippedToggle
              onToggleSkipped={toggleSkip}
            />
          </div>

          {/* Step 3: 確認 */}
          <div className="rounded-lg border border-[#E0DCD6] bg-card p-6 md:p-7">
            <div className="mb-2 text-base font-semibold text-primary md:text-lg">3. 確認匯入</div>
            <p className="mb-4 text-xs text-muted-foreground">
              預覽無誤後點下方按鈕，工項會寫入此案件。重複匯入時：已存在的項目（依「項次 + 名稱」判斷）不會覆蓋你已修改的內容。
            </p>
            {submitMsg && (
              <p
                className={`mb-3 rounded-md px-3 py-2 text-sm ${
                  submitMsg.startsWith("匯入失敗")
                    ? "border border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]"
                    : "border border-[#A7F3D0] bg-[#ECFDF5] text-[#4A7C59]"
                }`}
              >
                {submitMsg}
              </p>
            )}
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                將寫入 {parsed.stats.sections + parsed.stats.items + parsed.stats.specs - skippedIds.size} 筆，使用者勾略過 {skippedIds.size} 筆
              </div>
              <Button
                onClick={onConfirm}
                disabled={isPending}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isPending ? "匯入中…" : "確認匯入"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-[11px] tracking-wider text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{v}</span>
    </div>
  );
}
