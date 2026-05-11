"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { confirmImportAction } from "@/app/(app)/cases/[id]/import/actions";
import { getNextCaseCode } from "@/lib/case-codes";
import { COMPANIES } from "@/lib/companies";

const NewCaseSchema = z.object({
  name: z.string().trim().min(1, "案件名稱必填").max(200),
  code: z.string().trim().max(60).optional().or(z.literal("")),
  company: z.enum(COMPANIES, { message: "請選擇承接公司" }),
  location: z.string().trim().max(200).optional().or(z.literal("")),
  client: z.string().trim().max(120).optional().or(z.literal("")),
  started_at: z.string().trim().optional().or(z.literal("")),
  expected_end: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type NewCaseState =
  | {
      error?: string;
      fieldErrors?: Record<string, string[]>;
      caseId?: string; // 建立成功後讓 client 自己 push
    }
  | undefined;

type IncomingNode = {
  id: string;
  depth: number;
  sortPath: string;
  parentId: string | null;
  type: "section" | "item" | "spec" | "skip";
  tenderCode: string | null;
  name: string;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  brandNote: string | null;
  specText: string | null;
  skippedByUser: boolean;
};

type TenderPayload = {
  fileName: string;
  sheetName: string;
  stats: { rows: number; sections: number; items: number; specs: number; skipped: number };
  warnings: { row: number; msg: string }[];
  nodes: IncomingNode[];
};

/** 手動新增工項 — client 把過濾過的 list 用 JSON 帶在 formData.manualItems */
const ManualItemSchema = z.object({
  name: z.string().trim().min(1, "工項名稱必填").max(500),
  unit: z
    .union([z.string(), z.null()])
    .transform((v) => (typeof v === "string" ? v.trim() : null))
    .transform((v) => v || null),
  quantity: z
    .union([z.number(), z.string(), z.null()])
    .transform((v) => {
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (typeof v === "string") {
        const n = Number(v.trim());
        return Number.isFinite(n) ? n : null;
      }
      return null;
    }),
  unit_price: z
    .union([z.number(), z.string(), z.null()])
    .transform((v) => {
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (typeof v === "string") {
        const n = Number(v.trim());
        return Number.isFinite(n) ? n : null;
      }
      return null;
    }),
  brand_note: z
    .union([z.string(), z.null()])
    .transform((v) => (typeof v === "string" ? v.trim() : null))
    .transform((v) => v || null),
  parent_tender_code: z
    .union([z.string(), z.null()])
    .transform((v) => (typeof v === "string" ? v.trim() : null))
    .transform((v) => v || null),
});

export async function createCaseAction(
  _prev: NewCaseState,
  formData: FormData
): Promise<NewCaseState> {
  // 抽出基本欄位（避免把 tenderPayload 餵進 zod）
  const fields = {
    name: formData.get("name"),
    code: formData.get("code") ?? "",
    company: formData.get("company") ?? "",
    location: formData.get("location") ?? "",
    client: formData.get("client") ?? "",
    started_at: formData.get("started_at") ?? "",
    expected_end: formData.get("expected_end") ?? "",
    notes: formData.get("notes") ?? "",
  };
  const parsedFields = NewCaseSchema.safeParse(fields);
  if (!parsedFields.success) {
    return { fieldErrors: parsedFields.error.flatten().fieldErrors as Record<string, string[]> };
  }
  const data = parsedFields.data;

  // 標單 payload(可選)
  const rawPayload = formData.get("tenderPayload");
  let tender: TenderPayload | null = null;
  if (typeof rawPayload === "string" && rawPayload) {
    try {
      tender = JSON.parse(rawPayload) as TenderPayload;
    } catch {
      return { error: "工項資料無法解析，請重新上傳。" };
    }
  }

  // 手動新增工項 payload(可選) — client 已過濾空 name 的 row,這裡再 zod 驗一次
  const rawManual = formData.get("manualItems");
  let manualItems: z.infer<typeof ManualItemSchema>[] = [];
  if (typeof rawManual === "string" && rawManual) {
    try {
      const list = JSON.parse(rawManual) as unknown[];
      const validated = list
        .map((x) => ManualItemSchema.safeParse(x))
        .filter((r) => r.success)
        .map((r) => r.data);
      manualItems = validated;
    } catch {
      return { error: "手動工項資料無法解析,請檢查格式。" };
    }
  }

  const actor = await requireRole(["office_staff", "owner"]);
  const supabase = await createClient();

  // 編號決策：
  //   - 使用者手填(data.code 非空) → 用該值,撞號就直接報錯讓他改
  //   - 使用者留空 → server 端產號;若被別人搶先(unique violation),自動再產一個重試最多 5 次
  const userProvidedCode = !!data.code;
  let code = userProvidedCode ? data.code! : await getNextCaseCode(supabase);

  let row: { id: string } | null = null;
  let lastError: { code?: string; message?: string } | null = null;
  const maxAttempts = userProvidedCode ? 1 : 6;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ins = await supabase
      .from("cases")
      .insert({
        name: data.name,
        code: code || null,
        company: data.company,
        location: data.location || null,
        client: data.client || null,
        started_at: data.started_at || null,
        expected_end: data.expected_end || null,
        notes: data.notes || null,
        created_by: actor.id,
      })
      .select("id")
      .single();

    if (!ins.error && ins.data) {
      row = ins.data as { id: string };
      lastError = null;
      break;
    }
    lastError = ins.error;
    // 23505 = unique_violation;訊息含 cases_code_key 才確定是案件編號撞號
    const isCodeCollision =
      ins.error?.code === "23505" && /code/i.test(ins.error?.message ?? "");
    if (!isCodeCollision || userProvidedCode) break;
    // 自動產號被搶 → 重新算下一號再試
    code = await getNextCaseCode(supabase);
  }

  if (!row) {
    if (lastError?.code === "23505" && /code/i.test(lastError.message ?? "")) {
      return userProvidedCode
        ? { fieldErrors: { code: [`案件編號「${code}」已被使用,請換一個。`] } }
        : { error: "系統忙線中（自動編號連續撞號），請稍後再試。" };
    }
    return { error: "建立失敗：" + (lastError?.message ?? "未知錯誤") };
  }
  const caseId = row.id;

  // 有標單 → 一併匯入工項
  if (tender) {
    const importRes = await confirmImportAction({
      caseId,
      fileName: tender.fileName,
      nodes: tender.nodes,
      stats: tender.stats,
      warnings: tender.warnings,
    });
    if (!importRes.ok) {
      return {
        error: `案件已建立，但工項匯入失敗：${importRes.error}。請至案件頁面重試匯入。`,
        caseId,
      };
    }
  }

  // 手動新增工項 → 預設放最上層;若指定 parent_tender_code 就掛到該 section 底下
  if (manualItems.length > 0) {
    // 1) 撈所有 root + sections 的 sort_path / depth / id,給 parent 對應 + 算下一個 sort_path 用
    const referencedTenderCodes = Array.from(
      new Set(
        manualItems
          .map((m) => m.parent_tender_code)
          .filter((c): c is string => !!c),
      ),
    );

    type SectionInfo = { id: string; sort_path: string; depth: number };
    const sectionByTenderCode = new Map<string, SectionInfo>();
    if (referencedTenderCodes.length > 0) {
      const { data: secs } = await supabase
        .from("case_work_items")
        .select("id, sort_path, depth, tender_code")
        .eq("case_id", caseId)
        .eq("item_type", "section")
        .in("tender_code", referencedTenderCodes);
      for (const s of secs ?? []) {
        const tc = s.tender_code as string | null;
        if (tc) {
          sectionByTenderCode.set(tc, {
            id: s.id as string,
            sort_path: s.sort_path as string,
            depth: s.depth as number,
          });
        }
      }
    }

    // 2) 根層 next sort_path(同先前邏輯)
    const { data: rootRows } = await supabase
      .from("case_work_items")
      .select("sort_path")
      .eq("case_id", caseId)
      .is("parent_id", null)
      .order("sort_path", { ascending: false })
      .limit(1);
    let rootNextSeq = 1;
    if (rootRows && rootRows.length > 0) {
      const sp = (rootRows[0].sort_path as string) ?? "";
      const n = parseInt(sp.split(".")[0], 10);
      if (Number.isFinite(n)) rootNextSeq = n + 1;
    }

    // 3) 為每個指定 parent 的 section 撈當前最大子項 sort_path(分別計算)
    const childNextSeqByParent = new Map<string, number>();
    for (const sec of sectionByTenderCode.values()) {
      const { data: kidRows } = await supabase
        .from("case_work_items")
        .select("sort_path")
        .eq("case_id", caseId)
        .eq("parent_id", sec.id)
        .order("sort_path", { ascending: false })
        .limit(1);
      let next = 1;
      if (kidRows && kidRows.length > 0) {
        const segs = (kidRows[0].sort_path as string).split(".");
        const lastSeg = segs[segs.length - 1] ?? "";
        const n = parseInt(lastSeg, 10);
        if (Number.isFinite(n)) next = n + 1;
      }
      childNextSeqByParent.set(sec.id, next);
    }

    const rows = manualItems.map((m) => {
      const totalPrice =
        m.quantity !== null && m.unit_price !== null
          ? Number((m.quantity * m.unit_price).toFixed(2))
          : null;
      const sec = m.parent_tender_code
        ? sectionByTenderCode.get(m.parent_tender_code)
        : null;
      let parentId: string | null = null;
      let depth = 0;
      let sortPath: string;
      if (sec) {
        parentId = sec.id;
        depth = sec.depth + 1;
        const seq = childNextSeqByParent.get(sec.id) ?? 1;
        childNextSeqByParent.set(sec.id, seq + 1);
        sortPath = `${sec.sort_path}.${String(seq).padStart(4, "0")}`;
      } else {
        sortPath = String(rootNextSeq).padStart(4, "0");
        rootNextSeq += 1;
      }
      return {
        case_id: caseId,
        parent_id: parentId,
        sort_path: sortPath,
        depth,
        item_type: "manual" as const,
        tender_code: null,
        name: m.name,
        unit: m.unit,
        quantity: m.quantity,
        unit_price: m.unit_price,
        total_price: totalPrice,
        brand_note: m.brand_note,
        modified_by_user: true,
        created_by: actor.id,
      };
    });

    const { error: insErr } = await supabase
      .from("case_work_items")
      .insert(rows);
    if (insErr) {
      return {
        error: `案件已建立${tender ? "(標單也已匯入)" : ""},但手動工項插入失敗:${insErr.message}。請至案件頁面手動補建。`,
        caseId,
      };
    }
  }

  revalidatePath("/cases");
  return { caseId };
}
