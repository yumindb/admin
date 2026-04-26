"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  WorkItemsPicker,
  type PickerItem,
  type PickerValue,
} from "@/components/work-items-picker";
import { ExtraItemsEditor, type ColumnDef } from "@/components/extra-items-editor";
import { saveLogAction } from "./actions";
import { uploadPhotoAction } from "../[id]/photo-actions";
import type {
  DailyLogExtraItem,
  DailyLogUnsignedItem,
} from "@/lib/types";

export type CaseOption = {
  id: string;
  name: string;
  code: string | null;
  workItems: PickerItem[];
};

export function NewLogForm({
  cases,
  presetCaseId,
  initial,
  logId,
}: {
  cases: CaseOption[];
  presetCaseId?: string;
  initial?: {
    caseId: string;
    logDate: string;
    weather: string;
    manpowerOwn: number;
    manpowerContract: number;
    workItems: PickerValue[];
    extraItems: DailyLogExtraItem[];
    unsignedItems: DailyLogUnsignedItem[];
    photos: string[];
    notes: string;
  };
  logId?: string;
}) {
  const router = useRouter();

  // localStorage 自動存草稿:只對新建(沒 logId)生效。
  const draftKey = logId ? null : "yumin-newlog-draft-v1";
  const [draft] = useState<StoredDraft | null>(() => readStoredDraft(draftKey));

  const [caseId, setCaseId] = useState(
    draft?.caseId ?? initial?.caseId ?? presetCaseId ?? ""
  );
  const [logDate, setLogDate] = useState(
    draft?.logDate ?? initial?.logDate ?? new Date().toISOString().slice(0, 10)
  );
  const [weather, setWeather] = useState(draft?.weather ?? initial?.weather ?? "");
  const [own, setOwn] = useState<string>(
    draft?.own ?? String(initial?.manpowerOwn ?? "")
  );
  const [contract, setContract] = useState<string>(
    draft?.contract ?? String(initial?.manpowerContract ?? "")
  );
  const [picked, setPicked] = useState<PickerValue[]>(
    draft?.picked ?? initial?.workItems ?? []
  );
  const [extras, setExtras] = useState<DailyLogExtraItem[]>(
    draft?.extras ?? initial?.extraItems ?? []
  );
  const [unsigned, setUnsigned] = useState<DailyLogUnsignedItem[]>(
    draft?.unsigned ?? initial?.unsignedItems ?? []
  );
  const [photos, setPhotos] = useState<string[]>(
    draft?.photos ?? initial?.photos ?? []
  );
  const [notes, setNotes] = useState(draft?.notes ?? initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [autosaved, setAutosaved] = useState(Boolean(draft));
  const [isPending, startTransition] = useTransition();

  // debounce 寫 localStorage
  useEffect(() => {
    if (!draftKey) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            caseId, logDate, weather, own, contract, picked,
            extras, unsigned, photos, notes,
          })
        );
        setAutosaved(true);
      } catch {
        // quota exceeded — silently ignore
      }
    }, 600);
    return () => clearTimeout(t);
  }, [
    draftKey, caseId, logDate, weather, own, contract, picked,
    extras, unsigned, photos, notes,
  ]);

  const selectedCase = useMemo(
    () => cases.find((c) => c.id === caseId),
    [cases, caseId]
  );
  const items = selectedCase?.workItems ?? [];

  // 切案件時重設工項勾選
  function changeCase(next: string) {
    setCaseId(next);
    setPicked([]);
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
    startTransition(async () => {
      const res = await saveLogAction({
        logId,
        caseId,
        logDate,
        weather,
        manpower: {
          own: own ? Number(own) : undefined,
          contract: contract ? Number(contract) : undefined,
        },
        workItems: picked,
        extraItems: extras,
        unsignedItems: unsigned,
        photos,
        notes,
        intent,
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
    <div className="space-y-6">
      {/* 案件選擇 */}
      <Section title="1. 案件">
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

      {/* 基本 */}
      <Section title="2. 日期 / 天氣">
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
            <Label>天氣</Label>
            <div className="flex flex-wrap gap-2">
              {["晴", "多雲", "陰", "小雨", "大雨", "雨停"].map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWeather(weather === w ? "" : w)}
                  className={`min-h-[44px] rounded-md border px-4 text-sm transition-colors ${
                    weather === w
                      ? "border-accent bg-accent text-white"
                      : "border-[#E0DCD6] bg-white text-foreground hover:bg-[#FAF7F2]"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* 人力 */}
      <Section title="3. 人力(可選填)">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="own">自有</Label>
            <Input
              id="own"
              type="number"
              inputMode="numeric"
              min={0}
              value={own}
              onChange={(e) => setOwn(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contract">統包</Label>
            <Input
              id="contract"
              type="number"
              inputMode="numeric"
              min={0}
              value={contract}
              onChange={(e) => setContract(e.target.value)}
              placeholder="0"
            />
          </div>
        </div>
      </Section>

      {/* 工項 */}
      <Section
        title={`4. 工項${picked.length > 0 ? ` (已選 ${picked.length})` : ""}`}
      >
        {!caseId ? (
          <p className="text-sm text-muted-foreground">先選案件才能勾工項</p>
        ) : (
          <WorkItemsPicker items={items} value={picked} onChange={setPicked} />
        )}
      </Section>

      {/* 合約外項目 */}
      <Section
        title={`5. 合約外項目${extras.length > 0 ? ` (${extras.length})` : ""}`}
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

      {/* 未簽約項目 */}
      <Section
        title={`6. 未簽約項目${unsigned.length > 0 ? ` (${unsigned.length})` : ""}`}
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

      {/* 照片 */}
      <Section title={`7. 照片${photos.length > 0 ? ` (${photos.length})` : ""}`}>
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

      {/* 備註 */}
      <Section title="8. 備註(重要事項紀錄)">
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="例:下午下大雨停工 / 客戶要求改…"
          className="w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
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

      {/* 動作 */}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#E0DCD6] bg-background px-4 py-4 md:static md:mx-0 md:rounded-md md:border md:bg-card md:px-5">
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
    <section className="rounded-lg border border-[#E0DCD6] bg-card p-5 md:p-6">
      <h2 className="mb-1 text-base font-semibold text-primary md:text-lg">{title}</h2>
      {hint && <p className="mb-4 text-sm text-muted-foreground">{hint}</p>}
      {!hint && <div className="mb-4" />}
      {children}
    </section>
  );
}

const EMPTY_EXTRA: DailyLogExtraItem = { name: "" };
const EMPTY_UNSIGNED: DailyLogUnsignedItem = { name: "" };

type StoredDraft = {
  caseId?: string;
  logDate?: string;
  weather?: string;
  own?: string;
  contract?: string;
  picked?: PickerValue[];
  extras?: DailyLogExtraItem[];
  unsigned?: DailyLogUnsignedItem[];
  photos?: string[];
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
