"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CaseFormFields, type CaseFormDefaults } from "@/components/case-form";
import { NextStepHint } from "@/components/next-step-hint";
import { WorkItemsTree, type TreeItem } from "@/components/work-items-tree";
import {
  ExtraItemsEditor,
  type ColumnDef,
} from "@/components/extra-items-editor";
import {
  parseTenderArrayBuffer,
  flattenTree,
  type ParsedNode,
  type ParseResult,
} from "@/lib/tender-parser";
import { createCaseAction, type NewCaseState } from "./actions";

type ParsedState = ParseResult & { sheetName: string; fileName: string };

/** 手動新增工項 — 開新案表單上的小型編輯器 (選填,無標單時也能列幾筆) */
type ManualItemDraft = {
  name: string;
  unit?: string;
  quantity?: number;
  unit_price?: number;
  brand_note?: string;
  /** 對應已上傳標單的某個 section 的 tender_code(例「壹.二.10」、「第1類」)。
   *  伺服端用 (case_id, item_type='section', tender_code) 查到 server-side id 當作 parent_id。
   *  空值 = 不指定上層分類,放最上層。 */
  parent_tender_code?: string;
};
const EMPTY_MANUAL_ITEM: ManualItemDraft = { name: "" };

export function NewCaseForm({ suggestedCode = "" }: { suggestedCode?: string }) {
  const router = useRouter();
  const [defaults, setDefaults] = useState<CaseFormDefaults>({ code: suggestedCode });
  const [parsed, setParsed] = useState<ParsedState | null>(null);
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<NewCaseState>(undefined);
  const [isPending, startTransition] = useTransition();
  // 用 key 強制 fields 在 defaults 改變時 re-mount（內部用 defaultValue）
  const [fieldsKey, setFieldsKey] = useState(0);
  // 手動新增的工項 (沒有標單時也能列幾筆,跟標單匯入並存無妨)
  const [manualItems, setManualItems] = useState<ManualItemDraft[]>([]);

  // 從 parsed tender 抽出 section 列表,給「上層分類」dropdown 用
  // value 用 tender_code(server 端可用 (case_id, item_type='section', tender_code) 查 id)
  const sectionOptions = useMemo(() => {
    if (!parsed) return [] as { value: string; label: string }[];
    const flat = flattenTree(parsed.tree);
    return flat
      .filter((n) => n.type === "section" && n.tenderCode)
      .map((n) => ({
        value: n.tenderCode as string,
        label: `${"  ".repeat(n.depth)}${n.tenderCode}  ${n.name}`,
      }));
  }, [parsed]);

  // 動態組欄位:沒標單時隱藏「上層分類」,有標單時加進來放在最後
  const manualItemCols = useMemo<ColumnDef<ManualItemDraft>[]>(() => {
    const base: ColumnDef<ManualItemDraft>[] = [
      { key: "name", label: "工項名稱", required: true, placeholder: "例：配電盤升級" },
      { key: "unit", label: "單位", placeholder: "式 / 組 / m" },
      { key: "quantity", label: "數量", type: "number", inputMode: "decimal" },
      { key: "unit_price", label: "單價", type: "number", inputMode: "decimal" },
      { key: "brand_note", label: "備註", placeholder: "選填" },
    ];
    if (sectionOptions.length > 0) {
      base.push({
        key: "parent_tender_code",
        label: "上層分類（選填）",
        type: "select",
        selectOptions: sectionOptions,
        selectEmptyLabel: "（不指定 — 放在最上層）",
      });
    }
    return base;
  }, [sectionOptions]);

  async function onFile(file: File | null) {
    setParseError(null);
    if (!file) {
      setParsed(null);
      setSkippedIds(new Set());
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const result = parseTenderArrayBuffer(buf);
      setParsed({ ...result, fileName: file.name });
      setSkippedIds(new Set());
      setDefaults({
        name: result.header.name ?? "",
        // 標單／報價單若有「工程編號」用它，否則沿用建議流水號
        code: result.header.code || suggestedCode,
        location: result.header.location ?? "",
        client: result.header.client ?? "",
      });
      setFieldsKey((k) => k + 1);
    } catch (err) {
      setParseError("讀取失敗：" + (err as Error).message);
      setParsed(null);
      setSkippedIds(new Set());
    }
  }

  function clearTender() {
    setParsed(null);
    setSkippedIds(new Set());
    setParseError(null);
  }

  function toggleSkip(id: string, next: boolean) {
    setSkippedIds((prev) => {
      const n = new Set(prev);
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

  const treeItems: TreeItem[] = useMemo(() => {
    if (!parsed) return [];
    return flattenTree(parsed.tree).map((n) => ({
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
    }));
  }, [parsed, skippedIds]);

  // 算「真正的工項數」— 只算 leaf(item + spec),不算 section 分類層;
  // 略過數扣掉時也只扣 leaf 略過(section 略過邏輯上跟著子項走,但統計時已分開)
  const skippedLeafCount = useMemo(() => {
    if (!parsed) return 0;
    const flat = flattenTree(parsed.tree);
    let n = 0;
    for (const node of flat) {
      if (skippedIds.has(node.id) && (node.type === "item" || node.type === "spec")) {
        n++;
      }
    }
    return n;
  }, [parsed, skippedIds]);
  const willImportCount = parsed
    ? parsed.stats.items + parsed.stats.specs - skippedLeafCount
    : 0;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending) return;
    const formData = new FormData(e.currentTarget);

    if (parsed) {
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
      formData.set(
        "tenderPayload",
        JSON.stringify({
          fileName: parsed.fileName,
          sheetName: parsed.sheetName,
          stats: parsed.stats,
          warnings: parsed.warnings,
          nodes,
        })
      );
    }

    // 手動工項 — 過濾空 name 的 row;parent_client_id 對應 parsed.tree 的 section node id
    const validManual = manualItems
      .map((m) => ({
        name: typeof m.name === "string" ? m.name.trim() : "",
        unit: typeof m.unit === "string" ? m.unit.trim() : "",
        quantity:
          typeof m.quantity === "number" && Number.isFinite(m.quantity)
            ? m.quantity
            : null,
        unit_price:
          typeof m.unit_price === "number" && Number.isFinite(m.unit_price)
            ? m.unit_price
            : null,
        brand_note: typeof m.brand_note === "string" ? m.brand_note.trim() : "",
        parent_tender_code:
          typeof m.parent_tender_code === "string" && m.parent_tender_code
            ? m.parent_tender_code
            : null,
      }))
      .filter((m) => m.name);
    if (validManual.length > 0) {
      formData.set("manualItems", JSON.stringify(validManual));
    }

    startTransition(async () => {
      const res = await createCaseAction(undefined, formData);
      if (!res) return; // server action redirected — this branch shouldn't run
      if (res.caseId) {
        router.push(`/cases/${res.caseId}`);
        return;
      }
      setSubmitState(res);
    });
  }

  // 計算 submit 按鈕 label:標單 + 手動 兩邊都納入
  const manualValidCount = manualItems.filter(
    (m) => typeof m.name === "string" && m.name.trim(),
  ).length;
  const totalImportCount = willImportCount + manualValidCount;
  const submitLabel = isPending
    ? totalImportCount > 0
      ? `建立中…（將匯入 ${totalImportCount} 項）`
      : "建立中…"
    : totalImportCount > 0
      ? `建立案件並匯入 ${totalImportCount} 項工項`
      : "建立案件";

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* 1) 上傳標單／報價單區 */}
      <section className="rounded-md border border-dashed border-[#E0DCD6] bg-[#FBF8F4] p-4 md:p-5">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-sm font-medium text-primary">先上傳標單／報價單（選用）</div>
          {parsed && (
            <button
              type="button"
              onClick={clearTender}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-accent hover:underline"
            >
              移除檔案
            </button>
          )}
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          上傳 .xlsx 會自動辨識格式（公家標單／報價單），帶入工程名稱、地點、客戶等資料並列出工項預覽；按下「建立案件」會一次寫入。
        </p>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          className="block w-full rounded-md border border-[#E0DCD6] bg-white p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
        />
        {parseError && (
          <p className="mt-3 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
            {parseError}
          </p>
        )}
        {parsed && !parseError && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#4A7C59]">
            <span className="rounded-md bg-[#ECFDF5] px-2 py-1">
              已解析「{parsed.fileName}」· {parsed.sheetName}
            </span>
            <Stat label="分類" v={parsed.stats.sections} />
            <Stat label="工項" v={parsed.stats.items} />
            <Stat label="規格" v={parsed.stats.specs} />
            <Stat label="忽略" v={parsed.stats.skipped} muted />
            {parsed.warnings.length > 0 && (
              <span className="rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-2 py-1 text-[#92400E]">
                {parsed.warnings.length} 個解析警告
              </span>
            )}
          </div>
        )}
      </section>

      {/* 2) 案件欄位 */}
      <CaseFormFields
        key={fieldsKey}
        defaults={defaults}
        fieldErrors={submitState?.fieldErrors}
      />

      {/* 3) 工項預覽 — 只在已解析時顯示 */}
      {parsed && (
        <section className="rounded-md border border-[#E0DCD6] bg-card p-4 md:p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-primary">工項預覽</div>
            <div className="text-xs text-muted-foreground">
              工項 {willImportCount} 項
              <span className="ml-1 opacity-70">
                （另含 {parsed.stats.sections} 個分類層 · 勾略過 {skippedIds.size} 筆）
              </span>
            </div>
          </div>
          <WorkItemsTree
            items={treeItems}
            showSkippedToggle
            onToggleSkipped={toggleSkip}
          />
        </section>
      )}

      {/* 4) 手動新增工項 — 沒標單也能列幾筆；跟標單匯入並存無妨 */}
      <section className="rounded-md border border-[#E0DCD6] bg-card p-4 md:p-5">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-medium text-primary">
            手動新增工項{manualValidCount > 0 ? `（${manualValidCount}）` : "（選填）"}
          </div>
          <span className="text-xs text-muted-foreground">
            沒有標單可在這裡列幾筆；之後也可在案件頁繼續加
          </span>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          手動工項會以 item_type=&quot;manual&quot; 寫入，排在標單匯入項之後。空名稱的列會被忽略。
        </p>
        <ExtraItemsEditor<ManualItemDraft>
          rows={manualItems}
          onChange={setManualItems}
          empty={EMPTY_MANUAL_ITEM}
          columns={manualItemCols}
          addLabel="+ 新增一項工項"
          emptyHint="留空也可以，之後在案件頁加"
        />
      </section>

      {submitState?.error && (
        <p className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          {submitState.error}
        </p>
      )}

      {!parsed && manualValidCount === 0 && (
        <NextStepHint tone="info">
          沒有標單也可以只建立案件，之後再到案件頁補匯入；或在上方「手動新增工項」直接列幾筆。
        </NextStepHint>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        <Button asChild variant="ghost" type="button">
          <Link href="/cases">取消</Link>
        </Button>
        <Button
          type="submit"
          disabled={isPending}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Stat({ label, v, muted = false }: { label: string; v: number; muted?: boolean }) {
  return (
    <span className={muted ? "text-muted-foreground" : "text-foreground"}>
      {label} <span className="font-mono tabular-nums">{v}</span>
    </span>
  );
}
