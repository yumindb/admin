"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  WorkItemsPicker,
  type PickerItem,
  type PickerValue,
} from "@/components/work-items-picker";
import type { WorkItemAggregateMap } from "@/lib/work-item-aggregates";
import { ExtraItemsEditor, type ColumnDef } from "@/components/extra-items-editor";
import {
  AddTempWorkItemDialog,
  type AddTempCreated,
} from "@/components/add-temp-work-item-dialog";
import { Plus } from "lucide-react";
import { NextStepHint } from "@/components/next-step-hint";
import { getCompanyShort } from "@/lib/companies";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { saveLogAction } from "./actions";
import {
  deletePhotoAction,
  uploadPhotoAction,
  uploadSignatureAction,
} from "../[id]/photo-actions";
import {
  buildReportNumber,
  getRemainingDays,
  getWeekdayLabel,
  serializeWeather,
  WEATHER_OPTIONS,
  subcontractorKey,
} from "@/lib/daily-log";
import { formatTW } from "@/lib/datetime";
import type {
  DailyLogExtraItem,
  DailyLogMachine,
  DailyLogSubcontractor,
  DailyWeather,
  DailyLogUnsignedItem,
  FieldReportPhoto,
  LogPhoto,
} from "@/lib/types";

export type CaseOption = {
  id: string;
  name: string;
  code: string | null;
  company: string;
  location: string | null;
  expectedEnd: string | null;
  workItems: PickerItem[];          // 合約內(item/spec/manual,含 section parent)
  extraWorkItems: PickerItem[];     // 合約外(case_work_items.item_type='extra';扁平)
  unsignedWorkItems: PickerItem[];  // 未簽約(case_work_items.item_type='unsigned';扁平)
};

export type PendingFieldReport = {
  id: string;
  caseId: string;
  note: string;
  photos: FieldReportPhoto[];
  authorName: string;
  createdAt: string;
};

/** 現場回報的合併方式。photos 一律進照片區。
 * notes:文字接到「重要事項紀錄」+ 照片進照片區
 * photos-only:文字捨棄,只併照片(用在沒文字 / 不想帶文字)
 *
 * 拿掉「extra/unsigned」直送 picker 的選項 — 那條路徑混淆「事件紀錄」與
 * 「要追進度的工項」兩個心智模型,且自動截 30 字當工項名容易誤建。
 * 真的要把 report 變成合約外/未簽約工項,使用 section 4/5 的「+ 新增臨時項」。 */
type MergeDest = "notes" | "photos-only";

const MERGE_DEST_OPTIONS: {
  value: MergeDest;
  label: string;
  /** 此選項是否需要 report 有文字才能用 */
  requiresText: boolean;
}[] = [
  { value: "notes", label: "文字 + 照片一起合併", requiresText: true },
  { value: "photos-only", label: "只合併照片", requiresText: false },
];

function defaultDestFor(r: PendingFieldReport): MergeDest {
  return r.note.trim() ? "notes" : "photos-only";
}

export function NewLogForm({
  cases,
  presetCaseId,
  currentUserName,
  initial,
  logId,
  editMode = "classic",
  dayLogCounts,
  currentDaySeq,
  priorAggregates,
  priorManpowerByCase,
  priorSubcontractorByCase,
  priorMachineByCase,
  pendingReportsByCase,
  skipDraftRestore = false,
}: {
  cases: CaseOption[];
  presetCaseId?: string;
  currentUserName: string;
  /** "classic" = 草稿/退回的工地主任流程(會重新送出 + 簽名);
   *  "post-submission" = 已送出後的 silent edit(audit-only,不重啟簽核也不重簽) */
  editMode?: "classic" | "post-submission";
  /** 「複製日誌」場景:不還原 / 也不寫 localStorage 草稿,以免覆蓋 prefill 內容 */
  skipDraftRestore?: boolean;
  /** 開新日誌用：每案件每日的既有日誌筆數,用來算「當日第 NN 份」 */
  dayLogCounts?: Record<string, Record<string, number>>;
  /** 編輯既有日誌用：直接傳該日誌在當日的 seq(1-based) */
  currentDaySeq?: number;
  /** 各案件各工項的歷史累計與鎖定模式(由 server 撈 submitted/approved 日誌算出) */
  priorAggregates?: WorkItemAggregateMap;
  /** 各案件之前已累計的出工人次(submitted/approved 日誌 today_total 加總,編輯時排除自己) */
  priorManpowerByCase?: Record<string, number>;
  /** 各案件 → 工別正規化名 → 之前累計人次(submitted/approved 日誌的 today 加總) */
  priorSubcontractorByCase?: Record<string, Record<string, number>>;
  /** 各案件 → 機具正規化名 → 之前累計使用數量 */
  priorMachineByCase?: Record<string, Record<string, number>>;
  /** 各案件待整合的現場回報(pending) */
  pendingReportsByCase?: Record<string, PendingFieldReport[]>;
  initial?: {
    caseId: string;
    logDate: string;
    weather: DailyWeather;
    manpowerTodayTotal: number;
    subcontractors: DailyLogSubcontractor[];
    machines: DailyLogMachine[];
    workItems: PickerValue[];
    /** 編輯時:已選的 合約外 工項(從 work_items jsonb + case_work_items.item_type='extra' 解出) */
    pickedExtra?: PickerValue[];
    /** 編輯時:已選的 未簽約 工項(同上) */
    pickedUnsigned?: PickerValue[];
    extraItems: DailyLogExtraItem[];          // 舊資料相容
    unsignedItems: DailyLogUnsignedItem[];    // 舊資料相容
    photos: LogPhoto[];
    vendorNotices: string;
    notes: string;
  };
  logId?: string;
}) {
  const router = useRouter();

  // localStorage 自動存草稿:只對新建(沒 logId)生效。
  // ⚠ 不可在 useState initializer 讀 localStorage:server 拿不到 → null,
  //   client hydrate 拿得到 → 不同值,React hydration mismatch。
  //   改在 useEffect on-mount 拿,用 setters 覆寫初始值。
  // v2:photos schema 從 string[] 改為 { path, caption }[],舊草稿不相容直接捨棄
  // v3:合約外/未簽約 從 jsonb editor → picker(case_work_items),舊草稿不相容捨棄
  // 「複製日誌」場景:傳 skipDraftRestore,直接不讀 / 不寫 localStorage,
  //   讓 server 端傳的 initial 完全當主。
  const draftKey = logId || skipDraftRestore ? null : "yumin-newlog-draft-v3";

  const [caseId, setCaseId] = useState(initial?.caseId ?? presetCaseId ?? "");
  // logDate 也不能用 new Date() 當初值(server/client 跨午夜 UTC 會不同),
  // 留空字串等 mount 後在 useEffect 補今天
  const [logDate, setLogDate] = useState(initial?.logDate ?? "");
  const [weather, setWeather] = useState<DailyWeather>(initial?.weather ?? {});
  const [todayTotal, setTodayTotal] = useState<string>(
    String(initial?.manpowerTodayTotal ?? "")
  );
  const [subcontractors, setSubcontractors] = useState<DailyLogSubcontractor[]>(
    initial?.subcontractors ?? []
  );
  const [machines, setMachines] = useState<DailyLogMachine[]>(
    initial?.machines ?? []
  );
  const [picked, setPicked] = useState<PickerValue[]>(initial?.workItems ?? []);
  // 合約外 / 未簽約 在新架構是 picker(同 schema 走 daily_logs.work_items)
  const [pickedExtra, setPickedExtra] = useState<PickerValue[]>(
    initial?.pickedExtra ?? [],
  );
  const [pickedUnsigned, setPickedUnsigned] = useState<PickerValue[]>(
    initial?.pickedUnsigned ?? [],
  );
  // 「新增臨時項」即時加入的 extra/unsigned 工項;case 切換時會重設
  const [extraAdded, setExtraAdded] = useState<PickerItem[]>([]);
  const [unsignedAdded, setUnsignedAdded] = useState<PickerItem[]>([]);
  // 新增臨時項 dialog 控制
  const [tempDialogKind, setTempDialogKind] = useState<"extra" | "unsigned" | null>(null);
  // 舊資料相容用:legacy editor(目前僅 read-only 顯示舊草稿 / 來源日誌的 free-form jsonb,新流程不用)
  const [extras, setExtras] = useState<DailyLogExtraItem[]>(
    initial?.extraItems ?? []
  );
  const [unsigned, setUnsigned] = useState<DailyLogUnsignedItem[]>(
    initial?.unsignedItems ?? []
  );
  const [photos, setPhotos] = useState<LogPhoto[]>(initial?.photos ?? []);
  const [vendorNotices, setVendorNotices] = useState(initial?.vendorNotices ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [mergedReportIds, setMergedReportIds] = useState<string[]>([]);
  // post-submission 編輯儲存前的確認 modal
  const [showPostEditConfirm, setShowPostEditConfirm] = useState(false);
  // 已合併進來的回報快照(含照片) — 用來支援使用者刪掉照片後可以加回來
  const [mergedReportSnapshots, setMergedReportSnapshots] = useState<
    PendingFieldReport[]
  >([]);
  const [selectedReportIds, setSelectedReportIds] = useState<Set<string>>(
    () => new Set()
  );
  // 每筆勾選的回報要把文字併到哪:預設「重要事項」(原行為),也可選「非合約內」/「未簽約」
  const [reportDest, setReportDest] = useState<Map<string, MergeDest>>(
    () => new Map()
  );
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // 點照片放大檢視用 — 為 null 時不顯示;設成 path 時開啟 lightbox 顯示該張
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);
  const [autosaved, setAutosaved] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [isPending, startTransition] = useTransition();
  const sigRef = useRef<SignatureCanvas>(null);
  // 追蹤本次工作階段「在這個表單內上傳」的照片 path,
  // 供使用者按 × 或「取消」時清掉 Storage 內的暫存檔(避免孤兒檔累積)。
  // 不含 initial.photos(那些是已送出記錄、不可亂刪),
  // 也不含從現場回報合併進來的照片(那些是別張表單的 own data)。
  const sessionUploadsRef = useRef<Set<string>>(new Set());

  function clearSig() {
    sigRef.current?.clear();
    setError(null);
  }

  // mount 後:還原 localStorage 草稿 + 補 logDate 預設(今天)
  useEffect(() => {
    const draft = readStoredDraft(draftKey);
    if (draft) {
      if (draft.caseId !== undefined) setCaseId(draft.caseId);
      if (draft.logDate !== undefined) setLogDate(draft.logDate);
      if (draft.weather !== undefined) setWeather(draft.weather);
      if (draft.todayTotal !== undefined) setTodayTotal(draft.todayTotal);
      if (draft.subcontractors !== undefined) setSubcontractors(draft.subcontractors);
      if (draft.machines !== undefined) setMachines(draft.machines);
      if (draft.picked !== undefined) setPicked(draft.picked);
      if (draft.pickedExtra !== undefined) setPickedExtra(draft.pickedExtra);
      if (draft.pickedUnsigned !== undefined) setPickedUnsigned(draft.pickedUnsigned);
      if (draft.extras !== undefined) setExtras(draft.extras);
      if (draft.unsigned !== undefined) setUnsigned(draft.unsigned);
      if (draft.photos !== undefined) setPhotos(draft.photos);
      if (draft.vendorNotices !== undefined) setVendorNotices(draft.vendorNotices);
      if (draft.notes !== undefined) setNotes(draft.notes);
      if (draft.mergedReportIds !== undefined) setMergedReportIds(draft.mergedReportIds);
      if (draft.mergedReportSnapshots !== undefined)
        setMergedReportSnapshots(draft.mergedReportSnapshots);
      setAutosaved(true);
    } else if (!initial?.logDate) {
      // 沒草稿、也沒帶初始值 → logDate 設為今天
      setLogDate(new Date().toISOString().slice(0, 10));
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // debounce 寫 localStorage(等 hydrated 才開始,避免覆蓋掉 restore 中的 draft)
  useEffect(() => {
    if (!draftKey || !hydrated) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            caseId, logDate, weather, todayTotal,
            subcontractors, machines, picked, pickedExtra, pickedUnsigned,
            extras, unsigned,
            photos, vendorNotices, notes,
            mergedReportIds, mergedReportSnapshots,
          })
        );
        setAutosaved(true);
      } catch {
        // quota exceeded — silently ignore
      }
    }, 600);
    return () => clearTimeout(t);
  }, [
    draftKey, hydrated, caseId, logDate, weather, todayTotal,
    subcontractors, machines, picked, pickedExtra, pickedUnsigned,
    extras, unsigned, photos,
    vendorNotices, notes, mergedReportIds, mergedReportSnapshots,
  ]);

  const selectedCase = useMemo(
    () => cases.find((c) => c.id === caseId),
    [cases, caseId]
  );
  const items = selectedCase?.workItems ?? [];

  // 案件 picker 內的 extra/unsigned PickerItem 列表 = 案件原有 + 本次新增的臨時項
  // 用 useMemo 而非 useEffect 避免 setState-in-effect 的 cascading render
  // 去重必要:server action 成功後 Next.js auto-revalidate 當前 route → server props
  // 已含新項,但 client 的 extraAdded state 仍帶同一筆 id → 不去重會雙胞胎
  const extraItemsExtra = useMemo(
    () => dedupById([...(selectedCase?.extraWorkItems ?? []), ...extraAdded]),
    [selectedCase, extraAdded],
  );
  const unsignedItemsExtra = useMemo(
    () => dedupById([...(selectedCase?.unsignedWorkItems ?? []), ...unsignedAdded]),
    [selectedCase, unsignedAdded],
  );

  const remainingDays = getRemainingDays(selectedCase?.expectedEnd, logDate);

  // 累計出工人次 = 之前 submitted/approved 日誌的 today_total 加總 + 本日輸入。
  // 編輯模式下 priorManpowerByCase 已排除自己,不會雙倍計算。
  const priorManpower = caseId ? priorManpowerByCase?.[caseId] ?? 0 : 0;
  const todayTotalNum = todayTotal ? Number(todayTotal) : 0;
  const accumulatedTotalNum = priorManpower + (Number.isFinite(todayTotalNum) ? todayTotalNum : 0);

  // 工別 / 機具 名稱 → 之前累計(目前案件)
  const priorSubMap = caseId ? priorSubcontractorByCase?.[caseId] : undefined;
  const priorMachineMap = caseId ? priorMachineByCase?.[caseId] : undefined;

  // 算「之前 N」+「本日 M」= 累計值。空白 trade 視為 0。
  const accumulatedSubcontractor = (s: DailyLogSubcontractor) => {
    const k = subcontractorKey(s.trade);
    const prior = k ? priorSubMap?.[k] ?? 0 : 0;
    const today =
      typeof s.today === "number" && Number.isFinite(s.today) ? s.today : 0;
    return { prior, today, total: prior + today };
  };
  const accumulatedMachine = (m: DailyLogMachine) => {
    const k = subcontractorKey(m.name);
    const prior = k ? priorMachineMap?.[k] ?? 0 : 0;
    const today =
      typeof m.today === "number" && Number.isFinite(m.today) ? m.today : 0;
    return { prior, today, total: prior + today };
  };

  const subcontractorCols = useMemo<ColumnDef<DailyLogSubcontractor>[]>(
    () => [
      { key: "trade", label: "工別", required: true, placeholder: "例:泥作" },
      { key: "today", label: "本日人數", type: "number", inputMode: "numeric" },
      {
        key: "accumulated",
        label: "累計人數",
        compute: (row) => {
          const k = subcontractorKey(row.trade);
          if (!k) return null;
          return accumulatedSubcontractor(row).total;
        },
        computeHint: (row) => {
          const k = subcontractorKey(row.trade);
          if (!k) return "輸入工別後自動加總";
          const { prior, today } = accumulatedSubcontractor(row);
          return `之前 ${prior} 人次 + 本日 ${today}`;
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [priorSubMap],
  );

  const machineCols = useMemo<ColumnDef<DailyLogMachine>[]>(
    () => [
      { key: "name", label: "機具名稱", required: true, placeholder: "例:切割機" },
      {
        key: "today",
        label: "本日使用數量",
        type: "number",
        inputMode: "numeric",
      },
      {
        key: "accumulated",
        label: "累計使用數量",
        compute: (row) => {
          const k = subcontractorKey(row.name);
          if (!k) return null;
          return accumulatedMachine(row).total;
        },
        computeHint: (row) => {
          const k = subcontractorKey(row.name);
          if (!k) return "輸入機具名稱後自動加總";
          const { prior, today } = accumulatedMachine(row);
          return `之前 ${prior} + 本日 ${today}`;
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [priorMachineMap],
  );

  // 表報編號需要 案件 + 日期 + 當日序號(NN)
  // 編輯模式直接用後端算好的 currentDaySeq;新建模式用 dayLogCounts 算 +1
  const daySeq = currentDaySeq
    ?? (selectedCase && logDate
      ? (dayLogCounts?.[selectedCase.id]?.[logDate] ?? 0) + 1
      : 1);
  const reportNumber =
    selectedCase && logDate
      ? buildReportNumber({
          caseCode: selectedCase.code,
          logDate,
          daySeq,
        })
      : "—（請先選案件）";
  const weekdayLabel = logDate ? getWeekdayLabel(logDate) : "";

  // 切案件時重設工項勾選 + 清掉前一個案的回報勾選與臨時項
  function changeCase(next: string) {
    setCaseId(next);
    setPicked([]);
    setPickedExtra([]);
    setPickedUnsigned([]);
    setExtraAdded([]);
    setUnsignedAdded([]);
    setSelectedReportIds(new Set());
  }

  // 新增臨時項成功後:把新工項加到 picker 列表 + 自動勾選(qty=0 等待輸入)
  function handleTempCreated(kind: "extra" | "unsigned", created: AddTempCreated) {
    const newItem: PickerItem = {
      id: created.id,
      parentId: null,
      depth: 0,
      itemType: "item",
      tenderCode: null,
      name: created.name,
      unit: created.unit,
      totalQuantity: created.quantity,
    };
    const newValue: PickerValue = {
      work_item_id: created.id,
      qty: 0,
      qty_mode: defaultPickerMode(created.unit),
    };
    if (kind === "extra") {
      setExtraAdded((prev) => [...prev, newItem]);
      setPickedExtra((prev) => [...prev, newValue]);
    } else {
      setUnsignedAdded((prev) => [...prev, newItem]);
      setPickedUnsigned((prev) => [...prev, newValue]);
    }
  }

  // 從已合併進來的現場回報中,挑出「曾被併入但目前不在 photos 裡」的照片;
  // 給使用者一個「加回來」的退路(避免不小心刪掉就再也找不到)
  const missingMergedPhotos = useMemo(() => {
    if (mergedReportSnapshots.length === 0) return [];
    const havePaths = new Set(photos.map((p) => p.path));
    const seen = new Set<string>();
    const out: { path: string; caption: string }[] = [];
    for (const r of mergedReportSnapshots) {
      for (const p of r.photos) {
        if (havePaths.has(p.path)) continue;
        if (seen.has(p.path)) continue;
        seen.add(p.path);
        out.push({ path: p.path, caption: p.caption ?? "" });
      }
    }
    return out;
  }, [mergedReportSnapshots, photos]);

  // 該案件下未合併過、且使用者本次也還沒勾過合併的回報
  const availableReports = useMemo<PendingFieldReport[]>(() => {
    if (!caseId) return [];
    const list = pendingReportsByCase?.[caseId] ?? [];
    return list.filter((r) => !mergedReportIds.includes(r.id));
  }, [caseId, pendingReportsByCase, mergedReportIds]);

  function toggleReportSelection(id: string) {
    setSelectedReportIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function mergeSelectedReports() {
    if (selectedReportIds.size === 0) return;
    const picked = availableReports.filter((r) => selectedReportIds.has(r.id));
    if (picked.length === 0) return;

    function fmtTs(iso: string) {
      return formatTW(iso, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    function buildBlock(r: PendingFieldReport): string {
      const lines = [`【${fmtTs(r.createdAt)} ${r.authorName}】${r.note ?? ""}`.trimEnd()];
      for (const p of r.photos) {
        if (p.caption) lines.push(`  · ${p.caption}`);
      }
      return lines.join("\n");
    }

    setError(null);

    // 1. 文字併到「重要事項」(只在 dest='notes' 時);photos-only 文字直接丟
    const noteBlocks: string[] = [];
    for (const r of picked) {
      const dest: MergeDest = reportDest.get(r.id) ?? defaultDestFor(r);
      if (dest === "notes") noteBlocks.push(buildBlock(r));
    }
    if (noteBlocks.length > 0) {
      const joined = noteBlocks.join("\n\n");
      setNotes((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${joined}` : joined));
    }

    // 2. photos: 帶上 caption 一起合併,不重覆 path(共用 storage、不複製)
    const incoming: LogPhoto[] = picked.flatMap((r) =>
      r.photos.map((p) => ({ path: p.path, caption: p.caption ?? "" }))
    );
    if (incoming.length) {
      setPhotos((prev) => {
        const existing = new Set(prev.map((p) => p.path));
        const additions = incoming.filter((p) => !existing.has(p.path));
        return [...prev, ...additions];
      });
    }

    // 3. 紀錄已合併的 report ids,送出時帶到 server action
    setMergedReportIds((prev) => [...prev, ...picked.map((r) => r.id)]);
    setMergedReportSnapshots((prev) => [...prev, ...picked]);
    setSelectedReportIds(new Set());
    setReportDest(new Map());
  }

  function setDestForReport(id: string, dest: MergeDest) {
    setReportDest((prev) => {
      const next = new Map(prev);
      next.set(id, dest);
      return next;
    });
  }

  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });

  async function onUploadPhoto(files: FileList | null) {
    if (!files?.length) return;
    const validFiles = Array.from(files).filter((f) => {
      if (!f.type.startsWith("image/")) return false;
      if (f.size > 8 * 1024 * 1024) {
        setError(`照片 ${f.name} 超過 8MB,跳過`);
        return false;
      }
      return true;
    });
    if (!validFiles.length) return;

    setUploading(true);
    setError(null);
    setUploadProgress({ done: 0, total: validFiles.length });

    const preparedFiles = await Promise.all(validFiles.map((f) => compressPhoto(f)));

    // 並行上傳每張,完成一張就 +1
    const results = await Promise.all(
      preparedFiles.map(async (f) => {
        const fd = new FormData();
        fd.set("file", f);
        const res = await uploadPhotoAction(fd);
        setUploadProgress((p) => ({ ...p, done: p.done + 1 }));
        return res;
      })
    );

    const newPaths: string[] = [];
    let firstError: string | null = null;
    for (const r of results) {
      if (r.ok && r.path) newPaths.push(r.path);
      else if (!r.ok && !firstError) firstError = r.error;
    }
    if (newPaths.length) {
      for (const p of newPaths) sessionUploadsRef.current.add(p);
      setPhotos((p) => [
        ...p,
        ...newPaths.map<LogPhoto>((path) => ({ path, caption: "" })),
      ]);
    }
    if (firstError) setError(firstError);
    setUploading(false);
    setUploadProgress({ done: 0, total: 0 });
  }

  function removePhoto(path: string) {
    setPhotos((arr) => arr.filter((x) => x.path !== path));
    // 只刪本次階段上傳的(initial 或合併進來的不能動)。fire-and-forget,不卡 UI。
    if (sessionUploadsRef.current.has(path)) {
      sessionUploadsRef.current.delete(path);
      void deletePhotoAction(path);
    }
  }

  function setPhotoCaption(path: string, caption: string) {
    setPhotos((arr) =>
      arr.map((p) => (p.path === path ? { ...p, caption } : p))
    );
  }

  function cancel() {
    // 放棄本次表單:把這個工作階段上傳的暫存照片從 Storage 清掉,順便清 localStorage 草稿。
    // 不動 initial.photos(可能是編輯中既有日誌的照片)和合併進來的回報照片(那些有自己的記錄)。
    const toDelete = Array.from(sessionUploadsRef.current);
    sessionUploadsRef.current.clear();
    for (const p of toDelete) void deletePhotoAction(p);
    if (draftKey) {
      try {
        localStorage.removeItem(draftKey);
      } catch {}
    }
    router.push(logId ? `/logs/${logId}` : "/logs");
  }

  function submit(intent: "draft" | "submit" | "post_edit") {
    setError(null);
    if (!caseId) {
      setError("請選擇案件");
      return;
    }
    const totalPicked =
      picked.length + pickedExtra.length + pickedUnsigned.length;
    if (intent === "submit" && totalPicked === 0) {
      setError("送出前至少要選 1 個工項(合約內 / 合約外 / 未簽約 任一)");
      return;
    }

    let signaturePromise: Promise<string | undefined> = Promise.resolve(undefined);
    if (intent === "submit") {
      if (sigRef.current?.isEmpty()) {
        setError("送出前請在下方簽名");
        return;
      }
      const dataUrl = sigRef.current?.toDataURL("image/png");
      if (!dataUrl) {
        setError("簽名讀取失敗,請重試");
        return;
      }
      signaturePromise = (async () => {
        const fd = new FormData();
        fd.set("dataUrl", dataUrl);
        const upload = await uploadSignatureAction(fd);
        if (!upload.ok) throw new Error(upload.error);
        return upload.path;
      })();
    }

    startTransition(async () => {
      let signatureUrl: string | undefined;
      try {
        signatureUrl = await signaturePromise;
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      // 把計算出的累計值寫進 row,讓存進 DB / 報表 / PDF 看的都是自動加總
      const subcontractorsToSave = subcontractors.map((s) => ({
        ...s,
        accumulated: accumulatedSubcontractor(s).total,
      }));
      const machinesToSave = machines.map((m) => ({
        ...m,
        accumulated: accumulatedMachine(m).total,
      }));

      // 合約內 + 合約外 + 未簽約 都進同一個 work_items jsonb
      // (server-side 透過 case_work_items.item_type 判類別)
      const allWorkItems: PickerValue[] = [...picked, ...pickedExtra, ...pickedUnsigned];

      const res = await saveLogAction({
        logId,
        caseId,
        logDate,
        weather: serializeWeather(weather) ?? "",
        manpower: {
          today_total: todayTotal ? Number(todayTotal) : undefined,
          accumulated_total: todayTotal ? accumulatedTotalNum : undefined,
          subcontractors: subcontractorsToSave,
          machines: machinesToSave,
        },
        workItems: allWorkItems,
        extraItems: extras,
        unsignedItems: unsigned,
        photos,
        vendorNotices,
        notes,
        intent,
        fillSignatureUrl: signatureUrl,
        mergedReportIds,
      });
      if (!res.ok) {
        setError(res.error ?? "儲存失敗");
        return;
      }
      // 清掉本地草稿
      if (draftKey) {
        try {
          localStorage.removeItem(draftKey);
        } catch {}
      }
      router.push(`/logs/${res.logId}`);
    });
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* 表頭 — 手機:壓成一張小卡;桌機:完整 grid */}
      <div className="rounded-md border border-[#E0DCD6] bg-card px-4 py-3 md:hidden">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-xs text-muted-foreground">表報編號</span>
          <span className="font-mono text-sm font-medium text-primary">
            {reportNumber}
          </span>
        </div>
        <div className="mt-1.5 text-sm font-medium text-primary">
          {selectedCase?.name ?? "（先選案件）"}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>{logDate || "—"}{weekdayLabel ? ` ${weekdayLabel}` : ""}</span>
          {selectedCase?.company && <span>· {getCompanyShort(selectedCase.company)}</span>}
          {remainingDays !== null && <span>· 剩餘 {remainingDays} 天</span>}
          <span>· 填表 {currentUserName}</span>
        </div>
      </div>
      {/* 桌機:緊湊 2 行資訊條,不再 8 張卡片佔半個畫面 */}
      <div className="hidden rounded-lg border border-[#E0DCD6] bg-card px-5 py-4 md:block">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
          <HeaderField label="表報編號" value={reportNumber} mono />
          <HeaderField label="日期" value={`${logDate} ${weekdayLabel}`} />
          <HeaderField label="填表" value={currentUserName} />
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
          <HeaderField
            label="工程"
            value={selectedCase?.name ?? "（先選案件）"}
            highlight
          />
          {selectedCase?.company && (
            <HeaderField label="廠商" value={selectedCase.company} />
          )}
          {selectedCase?.location && (
            <HeaderField label="地點" value={selectedCase.location} />
          )}
          {selectedCase?.expectedEnd && (
            <HeaderField label="預完" value={selectedCase.expectedEnd} />
          )}
          {remainingDays !== null && (
            <HeaderField label="剩餘" value={`${remainingDays} 天`} />
          )}
        </div>
      </div>

      {/* 案件選擇 */}
      <Section title="案件選擇">
        {cases.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            目前沒有可用案件。請辦公室助理先開案。
          </p>
        ) : (
          <CasePicker
            cases={cases}
            value={caseId}
            onChange={changeCase}
          />
        )}
      </Section>

      {/* 待整合的現場回報 — 只在選了案件 + 該案有 pending 回報時出現 */}
      {caseId && availableReports.length > 0 && (
        <details
          open
          className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-5 md:p-6"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <h2 className="text-base font-semibold text-[#92400E] md:text-lg">
              待整合的現場回報 ({availableReports.length})
            </h2>
            <span className="text-xs text-[#92400E]">點開展開 / 收合</span>
          </summary>
          <p className="mt-1 mb-4 text-sm text-[#92400E]/80">
            勾選後選文字要併到哪一節,再按「合併到此日誌」。照片帶 caption 一起進照片區,被合併的回報會標為「已併入」不再出現在這。
          </p>
          <ul className="space-y-2">
            {availableReports.map((r) => {
              const checked = selectedReportIds.has(r.id);
              const hasText = r.note.trim().length > 0;
              const dest = reportDest.get(r.id) ?? defaultDestFor(r);
              const ts = formatTW(r.createdAt, {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <li key={r.id}>
                  <div
                    className={`rounded-md border bg-white transition-colors ${
                      checked
                        ? "border-[#A07850] bg-[#FAF7F2]"
                        : "border-[#E0DCD6] hover:border-[#A07850]/40"
                    }`}
                  >
                    <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleReportSelection(r.id)}
                        className="mt-1 size-5 shrink-0 cursor-pointer accent-[#A07850]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-muted-foreground">
                          {ts} · {r.authorName}
                          {r.photos.length > 0 && ` · ${r.photos.length} 張照片`}
                        </div>
                        {r.note && (
                          <p className="mt-1 whitespace-pre-line text-sm text-foreground">
                            {r.note}
                          </p>
                        )}
                        {r.photos.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {r.photos.slice(0, 6).map((p, idx) => (
                              <a
                                key={p.path + idx}
                                href={p.path}
                                target="_blank"
                                rel="noreferrer"
                                title={p.caption || undefined}
                                className="block size-14 overflow-hidden rounded border border-[#E0DCD6] bg-[#F5F1EC]"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={p.path}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              </a>
                            ))}
                            {r.photos.length > 6 && (
                              <span className="inline-flex size-14 items-center justify-center rounded border border-[#E0DCD6] bg-white text-xs text-muted-foreground">
                                +{r.photos.length - 6}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </label>
                    {checked && (
                      <div className="border-t border-[#E0DCD6]/60 bg-[#FAF7F2]/60 px-4 py-2">
                        <div
                          role="radiogroup"
                          aria-label="文字併到哪一節"
                          className="flex flex-wrap items-center gap-1.5 text-xs"
                        >
                          <span className="text-[#92400E]">文字併到:</span>
                          {MERGE_DEST_OPTIONS.map((opt) => {
                            const disabled = opt.requiresText && !hasText;
                            const active = dest === opt.value;
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                aria-disabled={disabled || undefined}
                                disabled={disabled}
                                title={disabled ? "此回報無文字,只能合併照片" : undefined}
                                onClick={() => {
                                  if (!disabled) setDestForReport(r.id, opt.value);
                                }}
                                className={`rounded-full border px-2.5 py-1 transition-colors ${
                                  active
                                    ? "border-[#A07850] bg-[#A07850] text-white"
                                    : disabled
                                      ? "cursor-not-allowed border-[#E8E2DA] bg-[#F5F1EC] text-[#B8B0A6]"
                                      : "border-[#E0DCD6] bg-white text-foreground hover:bg-[#F5F1EC]"
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              onClick={mergeSelectedReports}
              disabled={selectedReportIds.size === 0}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              合併到此日誌 ({selectedReportIds.size})
            </Button>
          </div>
        </details>
      )}

      {/* 基本 */}
      <Section title="日期 / 天氣">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="log_date">日期</Label>
            <Input
              id="log_date"
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              className="h-12"
            />
          </div>
          <div className="space-y-2">
            <Label>天氣（上午 / 下午）</Label>
            <WeatherPicker
              label="上午"
              value={weather.am}
              onChange={(value) => setWeather((prev) => ({ ...prev, am: value }))}
            />
            <WeatherPicker
              label="下午"
              value={weather.pm}
              onChange={(value) => setWeather((prev) => ({ ...prev, pm: value }))}
            />
          </div>
        </div>
      </Section>

      <Section title="出工人數">
        <div className="space-y-2">
          <Label htmlFor="today_total">本日出工人數</Label>
          <Input
            id="today_total"
            type="number"
            inputMode="numeric"
            min={0}
            value={todayTotal}
            onChange={(e) => setTodayTotal(e.target.value)}
            placeholder="0"
          />
          <p className="text-xs text-muted-foreground">
            累計出工人次:
            <span className="ml-1 font-medium text-primary">{accumulatedTotalNum}</span>
            <span className="ml-2 text-muted-foreground/80">
              （此案件之前 {priorManpower} 人次 + 本日 {todayTotalNum || 0} 人,自動加總）
            </span>
          </p>
        </div>
      </Section>

      <Section
        title="一、依施工計畫書執行按圖施工概況"
        hint="依照表單主體填寫施工項目、當日完成數量與累計進度"
      >
        {!caseId ? (
          <p className="text-sm text-muted-foreground">先選案件才能勾工項</p>
        ) : (
          <WorkItemsPicker
            items={items}
            value={picked}
            onChange={setPicked}
            aggregates={priorAggregates?.[caseId]}
          />
        )}
      </Section>

      <Section
        title="二、外包人員及機具管理"
        hint="對齊現有 Excel 的第二區塊，分開記錄工別與機具"
      >
        <div className="space-y-5">
          <ExtraItemsEditor<DailyLogSubcontractor>
            rows={subcontractors}
            onChange={setSubcontractors}
            empty={EMPTY_SUBCONTRACTOR}
            columns={subcontractorCols}
            addLabel="+ 新增工別"
            emptyHint="今天沒有外包工別就先留空"
          />
          <ExtraItemsEditor<DailyLogMachine>
            rows={machines}
            onChange={setMachines}
            empty={EMPTY_MACHINE}
            columns={machineCols}
            addLabel="+ 新增機具"
            emptyHint="今天沒有機具使用就先留空"
          />
        </div>
      </Section>

      <Section title="三、通知協力廠商辦理事項">
        <textarea
          rows={3}
          value={vendorNotices}
          onChange={(e) => setVendorNotices(e.target.value)}
          placeholder="例：通知水電廠商明日上午進場、補齊材料…"
          className="w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
      </Section>

      {/* 四、合約外(extra) — picker 從案件級工項撈,可即時新增臨時項 */}
      <Section
        title={`四、合約外項目（已簽約追加）${pickedExtra.length > 0 ? ` (${pickedExtra.length})` : ""}`}
        hint="已簽約追加但不在原合約內的工項。可累計進度,完成後自動隱藏。"
      >
        {!caseId ? (
          <p className="text-sm text-muted-foreground">先選案件才能勾合約外項目</p>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setTempDialogKind("extra")}
                className="inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-white px-3 py-1.5 text-xs text-foreground transition-colors hover:border-accent hover:text-accent"
              >
                <Plus className="size-3.5" /> 新增合約外項目
              </button>
            </div>
            {extraItemsExtra.length === 0 ? (
              <p className="rounded-md border border-dashed border-[#E0DCD6] bg-[#FAF7F2] px-4 py-6 text-center text-sm text-muted-foreground">
                此案件目前沒有合約外項目。需要追加時點上方「新增合約外項目」即時建立。
              </p>
            ) : (
              <WorkItemsPicker
                items={extraItemsExtra}
                value={pickedExtra}
                onChange={setPickedExtra}
                aggregates={priorAggregates?.[caseId]}
              />
            )}
          </div>
        )}
      </Section>

      {/* 五、未簽約(unsigned) — picker + 新增臨時項;報價由辦公室之後補 */}
      <Section
        title={`五、未簽約施工內容${pickedUnsigned.length > 0 ? ` (${pickedUnsigned.length})` : ""}`}
        hint="尚未追加合約 / 未報價,但現場有施工。報價由辦公室助理事後補,簽約後會自動歸到合約外項目。"
      >
        {!caseId ? (
          <p className="text-sm text-muted-foreground">先選案件才能勾未簽約項目</p>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setTempDialogKind("unsigned")}
                className="inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-white px-3 py-1.5 text-xs text-foreground transition-colors hover:border-accent hover:text-accent"
              >
                <Plus className="size-3.5" /> 新增未簽約項目
              </button>
            </div>
            {unsignedItemsExtra.length === 0 ? (
              <p className="rounded-md border border-dashed border-[#E0DCD6] bg-[#FAF7F2] px-4 py-6 text-center text-sm text-muted-foreground">
                此案件目前沒有未簽約項目。現場臨時施工時點上方「新增未簽約項目」即時建立。
              </p>
            ) : (
              <WorkItemsPicker
                items={unsignedItemsExtra}
                value={pickedUnsigned}
                onChange={setPickedUnsigned}
                aggregates={priorAggregates?.[caseId]}
              />
            )}
          </div>
        )}
      </Section>

      {tempDialogKind && caseId && (
        <AddTempWorkItemDialog
          open={!!tempDialogKind}
          onClose={() => setTempDialogKind(null)}
          caseId={caseId}
          kind={tempDialogKind}
          onCreated={(item) => handleTempCreated(tempDialogKind, item)}
        />
      )}

      {/* 舊資料相容:legacy jsonb editor — 只在編輯既有日誌且帶有舊資料時才顯示 */}
      {(extras.length > 0 || unsigned.length > 0) && (
        <Section
          title="（舊資料）合約外 / 未簽約 — 來自升等前的日誌格式"
          hint="這些是日誌升級前用 free-form 表填的內容,僅作 read-only 保留,新項目請改用上方 picker 填寫。"
        >
          {extras.length > 0 && (
            <div className="mb-4">
              <div className="mb-1 text-sm font-medium text-muted-foreground">
                合約外（舊）
              </div>
              <ExtraItemsEditor<DailyLogExtraItem>
                rows={extras}
                onChange={setExtras}
                empty={EMPTY_EXTRA}
                columns={EXTRA_COLS}
                addLabel="+ 新增合約外項目（舊格式）"
                emptyHint=""
              />
            </div>
          )}
          {unsigned.length > 0 && (
            <div>
              <div className="mb-1 text-sm font-medium text-muted-foreground">
                未簽約（舊）
              </div>
              <ExtraItemsEditor<DailyLogUnsignedItem>
                rows={unsigned}
                onChange={setUnsigned}
                empty={EMPTY_UNSIGNED}
                columns={UNSIGNED_COLS}
                addLabel="+ 新增未簽約項目（舊格式）"
                emptyHint=""
              />
            </div>
          )}
        </Section>
      )}

      <Section title={`照片區${photos.length > 0 ? ` (${photos.length})` : ""}`}>
        <input
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          onChange={(e) => onUploadPhoto(e.target.files)}
          disabled={uploading}
          className="block w-full rounded-md border border-[#E0DCD6] bg-white p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          手機照片會先在瀏覽器自動壓縮，再上傳到系統，減少現場等待時間。
        </p>
        {uploading && uploadProgress.total > 0 && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              上傳中… {uploadProgress.done}/{uploadProgress.total}
            </span>
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-[#E0DCD6]">
              <div
                className="h-full bg-accent transition-all"
                style={{
                  width: `${(uploadProgress.done / uploadProgress.total) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
        {photos.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            {photos.map((p) => (
              <div
                key={p.path}
                className="overflow-hidden rounded-md border border-[#E0DCD6] bg-white"
              >
                {/* 手機:固定 160px 高、object-contain 不裁切(跟現場回報一樣) */}
                {/* 桌機:維持 1:1 grid 整齊感,object-cover 填滿 */}
                <div className="relative h-40 bg-[#F5F1EC] md:aspect-square md:h-auto">
                  <button
                    type="button"
                    onClick={() => setLightboxPath(p.path)}
                    className="block h-full w-full cursor-zoom-in"
                    aria-label="放大檢視"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.path}
                      alt={p.caption || ""}
                      className="block h-full w-full object-contain md:object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => removePhoto(p.path)}
                    className="absolute right-1 top-1 inline-flex size-7 items-center justify-center rounded-full bg-black/60 text-base text-white hover:bg-black/80"
                    aria-label="刪除"
                  >
                    ×
                  </button>
                </div>
                <input
                  type="text"
                  value={p.caption}
                  onChange={(e) => setPhotoCaption(p.path, e.target.value)}
                  placeholder="說明（選填,例:三樓鋼樑焊接）"
                  className="block w-full border-t border-[#F0EBE4] bg-white px-2 py-1.5 text-xs outline-none placeholder:text-[#9C9088] focus-visible:bg-[#FAF7F2]"
                />
              </div>
            ))}
          </div>
        )}

        {/* 從合併進來的現場回報但被刪掉的照片 — 給「不小心刪掉、想加回來」的退路 */}
        {missingMergedPhotos.length > 0 && (
          <div className="mt-4 rounded-md border border-dashed border-[#FDE68A] bg-[#FFFBEB] p-3">
            <div className="mb-2 text-xs text-[#92400E]">
              從合併進來的現場回報移除過的照片 ({missingMergedPhotos.length}) — 不小心刪掉的可以再加回來
            </div>
            <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {missingMergedPhotos.map((p) => (
                <li
                  key={p.path}
                  className="overflow-hidden rounded-md border border-[#E8DFD3] bg-white"
                >
                  <div className="relative h-24 bg-[#F5F1EC]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.path}
                      alt={p.caption}
                      className="h-full w-full object-cover opacity-70"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setPhotos((prev) => [
                        ...prev,
                        { path: p.path, caption: p.caption },
                      ])
                    }
                    className="block w-full border-t border-[#F0EBE4] bg-white px-2 py-1.5 text-xs font-medium text-accent hover:bg-[#FAF7F2]"
                  >
                    + 加回來
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="六、重要事項紀錄">
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="例:下午下大雨停工 / 客戶要求改…"
          className="w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
      </Section>

      {editMode === "classic" && (
        <Section title="填表人簽名" hint={`填表人:${currentUserName}。送出核定前請在下方手寫簽名;只儲存草稿可不簽。`}>
          <div
            className="rounded-md border border-[#E0DCD6] bg-white"
            style={{ touchAction: "none" }}
          >
            <SignatureCanvas
              ref={sigRef}
              penColor="#003153"
              canvasProps={{
                className: "w-full",
                style: { width: "100%", height: "260px", touchAction: "none" },
              }}
            />
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={clearSig}
              className="text-xs text-muted-foreground hover:text-accent"
            >
              清除重簽
            </button>
          </div>
        </Section>
      )}

      {error && (
        <p className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          {error}
        </p>
      )}

      {!logId && autosaved && (
        <p className="text-center text-xs text-muted-foreground">
          ✓ 已自動暫存到此瀏覽器,下次回來會還原
        </p>
      )}

      <NextStepHint tone="info">
        {editMode === "post-submission"
          ? "這份日誌已送出,你的編輯會記錄一筆軌跡(誰、何時、改了哪些欄位),不會重啟簽核流程也不需要重新簽名。"
          : "「儲存草稿」可以晚點再回來填,只有你看得到。「送出核定」會通知老闆,送出後若要改要等被退回或請主管退回。"}
      </NextStepHint>

      {/* 動作 — 手機 sticky 緊貼底部 tab bar 上緣;桌機自然落地 */}
      <div
        className="sticky -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#E0DCD6] bg-background px-4 py-4 md:static md:bottom-auto md:mx-0 md:rounded-md md:border md:bg-card md:px-5"
        style={{ bottom: "calc(67px + env(safe-area-inset-bottom))" }}
      >
        <Button
          variant="ghost"
          type="button"
          onClick={cancel}
          disabled={isPending || uploading}
        >
          取消
        </Button>
        <div className="flex flex-wrap gap-3">
          {editMode === "classic" ? (
            <>
              <Button
                variant="outline"
                type="button"
                onClick={() => submit("draft")}
                disabled={isPending || uploading}
                className="border-[#E0DCD6]"
              >
                {isPending ? "儲存中…" : "儲存草稿"}
              </Button>
              <Button
                type="button"
                onClick={() => submit("submit")}
                disabled={isPending || uploading}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isPending ? "送出中…" : "送出核定"}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              onClick={() => setShowPostEditConfirm(true)}
              disabled={isPending || uploading}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isPending ? "儲存中…" : "儲存編輯"}
            </Button>
          )}
        </div>
      </div>

      <PhotoLightbox
        photos={photos}
        path={lightboxPath}
        onChange={setLightboxPath}
      />

      {showPostEditConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowPostEditConfirm(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="post-edit-confirm-title"
        >
          <div
            className="w-full max-w-md rounded-lg border border-[#E0DCD6] bg-card shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-[#E0DCD6] px-5 py-3">
              <h2
                id="post-edit-confirm-title"
                className="text-base font-semibold text-primary"
              >
                確認儲存編輯
              </h2>
            </div>
            <div className="px-5 py-4 text-sm leading-relaxed text-foreground">
              日誌已被簽核流程走過。儲存的修改不會自動通知簽核者。是否仍要儲存？
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[#E0DCD6] px-5 py-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowPostEditConfirm(false)}
                className="border-[#E0DCD6]"
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setShowPostEditConfirm(false);
                  submit("post_edit");
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                仍要儲存
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CasePicker({
  cases,
  value,
  onChange,
}: {
  cases: CaseOption[];
  value: string;
  onChange: (next: string) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = cases.find((c) => c.id === value);

  // 案件多時自動啟用搜尋(>= 6 才顯示搜尋框,免得 3-4 個案件還要先輸入)
  const showSearch = cases.length >= 6;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cases;
    return cases.filter((c) => {
      const haystack = `${c.code ?? ""} ${c.name} ${c.company} ${c.location ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [cases, query]);

  // 選中後預設收起列表,只顯示已選 + 「換一個」按鈕,省畫面
  const [browseOpen, setBrowseOpen] = useState(!value);
  useEffect(() => {
    // 切換 value 時:選新的就收起來,清掉就展開
    setBrowseOpen(!value);
  }, [value]);

  // 點某一列(換 / 不換 都算選定動作)→ 收起列表;只在實際換案時才呼叫 onChange
  // (避免不換的情況也觸發 changeCase 把已勾的工項重設掉)
  function handlePick(id: string) {
    if (id !== value) onChange(id);
    setBrowseOpen(false);
  }

  return (
    <div className="space-y-2">
      {selected && !browseOpen ? (
        <div className="flex items-center gap-3 rounded-md border border-accent bg-[#FAF7F2] px-3 py-2.5">
          <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-[#A07850] bg-white">
            <span className="size-2.5 rounded-full bg-[#A07850]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-mono text-xs text-muted-foreground">
                {selected.code ?? "未編號"}
              </span>
              <span className="break-words text-sm font-semibold text-primary md:text-base">
                {selected.name}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {selected.workItems.length} 個工項可填
            </div>
          </div>
          <button
            type="button"
            onClick={() => setBrowseOpen(true)}
            className="shrink-0 text-xs text-accent hover:underline"
          >
            換一個
          </button>
        </div>
      ) : (
        <>
          {showSearch && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`搜尋案件編號或名稱(共 ${cases.length} 個)`}
              className="h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            />
          )}
          <div className="max-h-[60vh] divide-y divide-[#F0EBE4] overflow-y-auto rounded-md border border-[#E0DCD6] bg-white">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                找不到符合「{query}」的案件
              </p>
            ) : (
              filtered.map((c) => (
                <label
                  key={c.id}
                  onClick={(e) => {
                    e.preventDefault();
                    handlePick(c.id);
                  }}
                  className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors ${
                    value === c.id
                      ? "bg-[#FAF7F2]"
                      : "hover:bg-[#F5F1EC]"
                  }`}
                >
                  <input
                    type="radio"
                    name="case"
                    checked={value === c.id}
                    readOnly
                    tabIndex={-1}
                    className="size-4 shrink-0 cursor-pointer accent-[#A07850]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {c.code ?? "未編號"}
                      </span>
                      <span className="break-words text-sm font-medium text-primary">
                        {c.name}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {c.workItems.length} 個工項可填
                    </div>
                  </div>
                </label>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[#E0DCD6] bg-card p-4 md:p-6">
      <h2 className="mb-1 text-base font-semibold text-primary md:text-lg">{title}</h2>
      {hint && <p className="mb-3 text-sm text-muted-foreground md:mb-4">{hint}</p>}
      {!hint && <div className="mb-3 md:mb-4" />}
      {children}
    </section>
  );
}

const EMPTY_EXTRA: DailyLogExtraItem = { name: "" };
const EMPTY_UNSIGNED: DailyLogUnsignedItem = { name: "" };

// 跟 work-items-picker 內 PERCENT_DEFAULT_UNITS 一致;新增臨時項時用同一套規則
const PERCENT_DEFAULT_UNITS = new Set([
  "組", "式", "套", "個", "處", "批", "戶", "棟",
  "件", "台", "部", "項", "座", "間",
]);
function defaultPickerMode(unit: string | null): "absolute" | "percent" {
  if (!unit) return "absolute";
  return PERCENT_DEFAULT_UNITS.has(unit.trim()) ? "percent" : "absolute";
}

/** 以 id 為 key 去重,保留先出現的(server props 優先,client local state 次之) */
function dedupById<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

type StoredDraft = {
  caseId?: string;
  logDate?: string;
  weather?: DailyWeather;
  todayTotal?: string;
  subcontractors?: DailyLogSubcontractor[];
  machines?: DailyLogMachine[];
  picked?: PickerValue[];
  pickedExtra?: PickerValue[];
  pickedUnsigned?: PickerValue[];
  extras?: DailyLogExtraItem[];
  unsigned?: DailyLogUnsignedItem[];
  photos?: LogPhoto[];
  vendorNotices?: string;
  notes?: string;
  mergedReportIds?: string[];
  mergedReportSnapshots?: PendingFieldReport[];
};

function readStoredDraft(draftKey: string | null): StoredDraft | null {
  if (!draftKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftKey);
    if (!raw) return null;
    return JSON.parse(raw) as StoredDraft;
  } catch {
    return null;
  }
}

async function compressPhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= 1.2 * 1024 * 1024) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.82);
    });
    if (!blob || blob.size >= file.size) return file;

    const nextName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], nextName, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#E0DCD6] bg-white px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium text-primary">{value}</div>
    </div>
  );
}

function HeaderField({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={
          (mono ? "font-mono " : "") +
          (highlight
            ? "text-base font-semibold text-primary"
            : "font-medium text-primary")
        }
      >
        {value}
      </span>
    </span>
  );
}

function WeatherPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DailyWeather["am"] | undefined;
  onChange: (value: DailyWeather["am"] | undefined) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-2">
        {WEATHER_OPTIONS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => onChange(value === w ? undefined : w)}
            className={`min-h-[44px] rounded-md border px-4 text-sm transition-colors ${
              value === w
                ? "border-accent bg-accent text-white"
                : "border-[#E0DCD6] bg-white text-foreground hover:bg-[#FAF7F2]"
            }`}
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}

const EXTRA_COLS: ColumnDef<DailyLogExtraItem>[] = [
  { key: "name", label: "施工項目", required: true, placeholder: "例:浴室牆面打除" },
  { key: "unit", label: "單位", placeholder: "例:㎡ / 式" },
  { key: "qty", label: "數量", type: "number" },
  { key: "headcount", label: "人數", type: "number", inputMode: "numeric" },
  { key: "location", label: "位置", placeholder: "例:1F 廁所" },
  { key: "requested_by", label: "甲方交辦人員", placeholder: "例:王主任" },
  { key: "reason", label: "事由", placeholder: "例:屋主臨時要求改格局" },
];

const UNSIGNED_COLS: ColumnDef<DailyLogUnsignedItem>[] = [
  { key: "name", label: "施工項目", required: true, placeholder: "例:配電盤升級" },
  { key: "unit", label: "單位" },
  { key: "qty", label: "數量", type: "number" },
  { key: "headcount", label: "人數", type: "number", inputMode: "numeric" },
  {
    key: "category",
    label: "類別",
    type: "select",
    options: ["點工", "變更追加"],
  },
  { key: "quote_amount", label: "報價金額(元)", type: "number" },
  { key: "reason", label: "尚未追加 / 報價事由", placeholder: "例:等業主決定材質" },
];

const EMPTY_SUBCONTRACTOR: DailyLogSubcontractor = { trade: "" };
const EMPTY_MACHINE: DailyLogMachine = { name: "" };

