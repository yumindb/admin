"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { saveLogAction } from "./actions";
import { uploadPhotoAction } from "../[id]/photo-actions";

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
    photos: string[];
    notes: string;
  };
  logId?: string;
}) {
  const router = useRouter();

  // localStorage 自動存草稿:只對新建(沒 logId)生效。每次 onChange debounce 寫入,
  // 進頁面時還原。送出/儲存草稿成功後清掉。
  const draftKey = logId ? null : "yumin-newlog-draft-v1";
  const restored = useRef(false);

  const [caseId, setCaseId] = useState(initial?.caseId ?? presetCaseId ?? "");
  const [logDate, setLogDate] = useState(
    initial?.logDate ?? new Date().toISOString().slice(0, 10)
  );
  const [weather, setWeather] = useState(initial?.weather ?? "");
  const [own, setOwn] = useState<string>(String(initial?.manpowerOwn ?? ""));
  const [contract, setContract] = useState<string>(
    String(initial?.manpowerContract ?? "")
  );
  const [picked, setPicked] = useState<PickerValue[]>(initial?.workItems ?? []);
  const [photos, setPhotos] = useState<string[]>(initial?.photos ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [autosaved, setAutosaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  // 進頁面還原草稿(只新建)
  useEffect(() => {
    if (!draftKey || restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.caseId) setCaseId(d.caseId);
      if (d.logDate) setLogDate(d.logDate);
      if (d.weather !== undefined) setWeather(d.weather);
      if (d.own !== undefined) setOwn(d.own);
      if (d.contract !== undefined) setContract(d.contract);
      if (Array.isArray(d.picked)) setPicked(d.picked);
      if (Array.isArray(d.photos)) setPhotos(d.photos);
      if (d.notes !== undefined) setNotes(d.notes);
      setAutosaved(true);
    } catch {
      // ignore corrupt draft
    }
  }, [draftKey]);

  // debounce 寫 localStorage
  useEffect(() => {
    if (!draftKey) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({ caseId, logDate, weather, own, contract, picked, photos, notes })
        );
        setAutosaved(true);
      } catch {
        // quota exceeded — silently ignore
      }
    }, 600);
    return () => clearTimeout(t);
  }, [draftKey, caseId, logDate, weather, own, contract, picked, photos, notes]);

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

    // 並行上傳每張,完成一張就 +1
    const results = await Promise.all(
      validFiles.map(async (f) => {
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
          <div className="space-y-2">
            {cases.map((c) => (
              <label
                key={c.id}
                className={`flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-colors ${
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
                  className="mt-1 size-4 shrink-0 cursor-pointer accent-[#A07850]"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground">
                    {c.code ?? "未編號"}
                  </div>
                  <div className="text-sm font-medium text-primary">{c.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
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

      {/* 照片 */}
      <Section title={`5. 照片${photos.length > 0 ? ` (${photos.length})` : ""}`}>
        <input
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          onChange={(e) => onUploadPhoto(e.target.files)}
          disabled={uploading}
          className="block w-full rounded-md border border-[#E0DCD6] bg-white p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
        />
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
      <Section title="6. 備註">
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
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-[#E0DCD6] bg-card p-5">
      <h2 className="mb-3 text-sm font-medium text-primary">{title}</h2>
      {children}
    </section>
  );
}
