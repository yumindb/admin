"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
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
import { NextStepHint } from "@/components/next-step-hint";
import { saveLogAction } from "./actions";
import { uploadPhotoAction, uploadSignatureAction } from "../[id]/photo-actions";
import {
  buildReportNumber,
  getRemainingDays,
  getWeekdayLabel,
  serializeWeather,
  WEATHER_OPTIONS,
} from "@/lib/daily-log";
import type {
  DailyLogExtraItem,
  DailyLogMachine,
  DailyLogSubcontractor,
  DailyWeather,
  DailyLogUnsignedItem,
  FieldReportPhoto,
} from "@/lib/types";

export type CaseOption = {
  id: string;
  name: string;
  code: string | null;
  company: string;
  location: string | null;
  expectedEnd: string | null;
  workItems: PickerItem[];
};

export type PendingFieldReport = {
  id: string;
  caseId: string;
  note: string;
  photos: FieldReportPhoto[];
  authorName: string;
  createdAt: string;
};

export function NewLogForm({
  cases,
  presetCaseId,
  currentUserName,
  initial,
  logId,
  dayLogCounts,
  currentDaySeq,
  priorAggregates,
  pendingReportsByCase,
}: {
  cases: CaseOption[];
  presetCaseId?: string;
  currentUserName: string;
  /** 開新日誌用：每案件每日的既有日誌筆數,用來算「當日第 NN 份」 */
  dayLogCounts?: Record<string, Record<string, number>>;
  /** 編輯既有日誌用：直接傳該日誌在當日的 seq(1-based) */
  currentDaySeq?: number;
  /** 各案件各工項的歷史累計與鎖定模式(由 server 撈 submitted/approved 日誌算出) */
  priorAggregates?: WorkItemAggregateMap;
  /** 各案件待整合的現場回報(pending) */
  pendingReportsByCase?: Record<string, PendingFieldReport[]>;
  initial?: {
    caseId: string;
    logDate: string;
    weather: DailyWeather;
    manpowerTodayTotal: number;
    manpowerAccumulatedTotal: number;
    subcontractors: DailyLogSubcontractor[];
    machines: DailyLogMachine[];
    workItems: PickerValue[];
    extraItems: DailyLogExtraItem[];
    unsignedItems: DailyLogUnsignedItem[];
    photos: string[];
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
  const draftKey = logId ? null : "yumin-newlog-draft-v1";

  const [caseId, setCaseId] = useState(initial?.caseId ?? presetCaseId ?? "");
  // logDate 也不能用 new Date() 當初值(server/client 跨午夜 UTC 會不同),
  // 留空字串等 mount 後在 useEffect 補今天
  const [logDate, setLogDate] = useState(initial?.logDate ?? "");
  const [weather, setWeather] = useState<DailyWeather>(initial?.weather ?? {});
  const [todayTotal, setTodayTotal] = useState<string>(
    String(initial?.manpowerTodayTotal ?? "")
  );
  const [accumulatedTotal, setAccumulatedTotal] = useState<string>(
    String(initial?.manpowerAccumulatedTotal ?? "")
  );
  const [subcontractors, setSubcontractors] = useState<DailyLogSubcontractor[]>(
    initial?.subcontractors ?? []
  );
  const [machines, setMachines] = useState<DailyLogMachine[]>(
    initial?.machines ?? []
  );
  const [picked, setPicked] = useState<PickerValue[]>(initial?.workItems ?? []);
  const [extras, setExtras] = useState<DailyLogExtraItem[]>(
    initial?.extraItems ?? []
  );
  const [unsigned, setUnsigned] = useState<DailyLogUnsignedItem[]>(
    initial?.unsignedItems ?? []
  );
  const [photos, setPhotos] = useState<string[]>(initial?.photos ?? []);
  const [vendorNotices, setVendorNotices] = useState(initial?.vendorNotices ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [mergedReportIds, setMergedReportIds] = useState<string[]>([]);
  const [selectedReportIds, setSelectedReportIds] = useState<Set<string>>(
    () => new Set()
  );
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [autosaved, setAutosaved] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [isPending, startTransition] = useTransition();
  const sigRef = useRef<SignatureCanvas>(null);

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
      if (draft.accumulatedTotal !== undefined) setAccumulatedTotal(draft.accumulatedTotal);
      if (draft.subcontractors !== undefined) setSubcontractors(draft.subcontractors);
      if (draft.machines !== undefined) setMachines(draft.machines);
      if (draft.picked !== undefined) setPicked(draft.picked);
      if (draft.extras !== undefined) setExtras(draft.extras);
      if (draft.unsigned !== undefined) setUnsigned(draft.unsigned);
      if (draft.photos !== undefined) setPhotos(draft.photos);
      if (draft.vendorNotices !== undefined) setVendorNotices(draft.vendorNotices);
      if (draft.notes !== undefined) setNotes(draft.notes);
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
            caseId, logDate, weather, todayTotal, accumulatedTotal,
            subcontractors, machines, picked, extras, unsigned,
            photos, vendorNotices, notes,
          })
        );
        setAutosaved(true);
      } catch {
        // quota exceeded — silently ignore
      }
    }, 600);
    return () => clearTimeout(t);
  }, [
    draftKey, hydrated, caseId, logDate, weather, todayTotal, accumulatedTotal,
    subcontractors, machines, picked, extras, unsigned, photos,
    vendorNotices, notes,
  ]);

  const selectedCase = useMemo(
    () => cases.find((c) => c.id === caseId),
    [cases, caseId]
  );
  const items = selectedCase?.workItems ?? [];
  const remainingDays = getRemainingDays(selectedCase?.expectedEnd, logDate);

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

  // 切案件時重設工項勾選 + 清掉前一個案的回報勾選
  function changeCase(next: string) {
    setCaseId(next);
    setPicked([]);
    setSelectedReportIds(new Set());
  }

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

    // 1. note: 每筆回報 prepend 「【MM/DD HH:mm 作者】」前綴後 append 進現有 notes
    const blocks = picked
      .map((r) => {
        const ts = new Date(r.createdAt).toLocaleString("zh-TW", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
        const lines = [`【${ts} ${r.authorName}】${r.note ?? ""}`.trimEnd()];
        for (const p of r.photos) {
          if (p.caption) lines.push(`  · ${p.caption}`);
        }
        return lines.join("\n");
      })
      .join("\n\n");

    setNotes((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${blocks}` : blocks));

    // 2. photos: 直接 push 同樣的 storage path(共用、不複製)
    const newPaths = picked.flatMap((r) => r.photos.map((p) => p.path));
    if (newPaths.length) {
      setPhotos((prev) => [...prev, ...newPaths.filter((p) => !prev.includes(p))]);
    }

    // 3. 紀錄已合併的 report ids,送出時帶到 server action
    setMergedReportIds((prev) => [...prev, ...picked.map((r) => r.id)]);
    setSelectedReportIds(new Set());
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
    if (newPaths.length) setPhotos((p) => [...p, ...newPaths]);
    if (firstError) setError(firstError);
    setUploading(false);
    setUploadProgress({ done: 0, total: 0 });
  }

  function removePhoto(p: string) {
    setPhotos((arr) => arr.filter((x) => x !== p));
  }

  function submit(intent: "draft" | "submit") {
    setError(null);
    if (!caseId) {
      setError("請選擇案件");
      return;
    }
    if (intent === "submit" && picked.length === 0) {
      setError("送出前至少要選 1 個工項");
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
      const res = await saveLogAction({
        logId,
        caseId,
        logDate,
        weather: serializeWeather(weather) ?? "",
        manpower: {
          today_total: todayTotal ? Number(todayTotal) : undefined,
          accumulated_total: accumulatedTotal ? Number(accumulatedTotal) : undefined,
          subcontractors,
          machines,
        },
        workItems: picked,
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
          {selectedCase?.company && <span>· {selectedCase.company}</span>}
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
          <div className="space-y-2.5">
            {cases.map((c) => (
              <label
                key={c.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-5 py-4 transition-colors ${
                  caseId === c.id
                    ? "border-accent bg-[#FAF7F2]"
                    : "border-[#E0DCD6] hover:border-[#A07850]/40"
                }`}
              >
                <input
                  type="radio"
                  name="case"
                  checked={caseId === c.id}
                  onChange={() => changeCase(c.id)}
                  className="mt-1 size-5 shrink-0 cursor-pointer accent-[#A07850]"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-muted-foreground">
                    {c.code ?? "未編號"}
                  </div>
                  <div className="text-base font-semibold text-primary md:text-lg">
                    {c.name}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {c.workItems.length} 個工項可填
                  </div>
                </div>
              </label>
            ))}
          </div>
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
            勾選後按「合併到此日誌」,文字會 append 到備註、照片會加進照片區。被合併的回報會標為「已併入」,不會再出現在這。
          </p>
          <ul className="space-y-2">
            {availableReports.map((r) => {
              const checked = selectedReportIds.has(r.id);
              const ts = new Date(r.createdAt).toLocaleString("zh-TW", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <li key={r.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-md border bg-white px-4 py-3 transition-colors ${
                      checked
                        ? "border-[#A07850] bg-[#FAF7F2]"
                        : "border-[#E0DCD6] hover:border-[#A07850]/40"
                    }`}
                  >
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="accumulated_total">累計出工人數</Label>
            <Input
              id="accumulated_total"
              type="number"
              inputMode="numeric"
              min={0}
              value={accumulatedTotal}
              onChange={(e) => setAccumulatedTotal(e.target.value)}
              placeholder="0"
            />
          </div>
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
            columns={SUBCONTRACTOR_COLS}
            addLabel="+ 新增工別"
            emptyHint="今天沒有外包工別就先留空"
          />
          <ExtraItemsEditor<DailyLogMachine>
            rows={machines}
            onChange={setMachines}
            empty={EMPTY_MACHINE}
            columns={MACHINE_COLS}
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

      {/* 工項 */}
      <Section
        title={`四、非合約內施工項目${extras.length > 0 ? ` (${extras.length})` : ""}`}
        hint="非合約內,但實際有施工的項目(甲方臨時交辦等)"
      >
        <ExtraItemsEditor<DailyLogExtraItem>
          rows={extras}
          onChange={setExtras}
          empty={EMPTY_EXTRA}
          columns={EXTRA_COLS}
          addLabel="+ 新增合約外項目"
          emptyHint="今天沒有合約外項目就不用填"
        />
      </Section>

      <Section
        title={`五、未簽約施工內容${unsigned.length > 0 ? ` (${unsigned.length})` : ""}`}
        hint="尚未追加合約 / 未報價的施工內容(點工或變更追加)"
      >
        <ExtraItemsEditor<DailyLogUnsignedItem>
          rows={unsigned}
          onChange={setUnsigned}
          empty={EMPTY_UNSIGNED}
          columns={UNSIGNED_COLS}
          addLabel="+ 新增未簽約項目"
          emptyHint="今天沒有未簽約項目就不用填"
        />
      </Section>

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
          <div className="mt-3 grid grid-cols-3 gap-2 md:grid-cols-4">
            {photos.map((p) => (
              <div key={p} className="relative aspect-square overflow-hidden rounded-md border border-[#E0DCD6] bg-[#F5F1EC]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(p)}
                  className="absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80"
                  aria-label="刪除"
                >
                  ×
                </button>
              </div>
            ))}
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
              style: { width: "100%", height: "220px", touchAction: "none" },
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
        「儲存草稿」可以晚點再回來填,只有你看得到。「送出核定」會通知老闆,送出後若要改要等被退回或請主管退回。
      </NextStepHint>

      {/* 動作 — 手機 sticky 在底部 tab bar 上方;桌機自然落地 */}
      <div className="sticky bottom-[80px] -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#E0DCD6] bg-background px-4 py-4 md:static md:mx-0 md:rounded-md md:border md:bg-card md:px-5">
        <Button asChild variant="ghost" type="button">
          <Link href="/logs">取消</Link>
        </Button>
        <div className="flex flex-wrap gap-3">
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
        </div>
      </div>
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

type StoredDraft = {
  caseId?: string;
  logDate?: string;
  weather?: DailyWeather;
  todayTotal?: string;
  accumulatedTotal?: string;
  subcontractors?: DailyLogSubcontractor[];
  machines?: DailyLogMachine[];
  picked?: PickerValue[];
  extras?: DailyLogExtraItem[];
  unsigned?: DailyLogUnsignedItem[];
  photos?: string[];
  vendorNotices?: string;
  notes?: string;
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

const SUBCONTRACTOR_COLS: ColumnDef<DailyLogSubcontractor>[] = [
  { key: "trade", label: "工別", required: true, placeholder: "例:泥作" },
  { key: "today", label: "本日人數", type: "number", inputMode: "numeric" },
  { key: "accumulated", label: "累計人數", type: "number", inputMode: "numeric" },
];

const MACHINE_COLS: ColumnDef<DailyLogMachine>[] = [
  { key: "name", label: "機具名稱", required: true, placeholder: "例:切割機" },
  { key: "today", label: "本日使用數量", type: "number", inputMode: "numeric" },
  { key: "accumulated", label: "累計使用數量", type: "number", inputMode: "numeric" },
];
