"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NextStepHint } from "@/components/next-step-hint";
import { uploadPhotoAction } from "../logs/[id]/photo-actions";
import { createFieldReportAction, updateFieldReportAction } from "./actions";
import type { FieldReportPhoto } from "@/lib/types";

export type CaseOption = {
  id: string;
  name: string;
  code: string | null;
};

type Props = {
  cases: CaseOption[];
  presetCaseId?: string;
  reportId?: string;
  initial?: {
    caseId: string;
    note: string;
    photos: FieldReportPhoto[];
  };
};

export function NewReportForm({ cases, presetCaseId, reportId, initial }: Props) {
  const router = useRouter();
  const [caseId, setCaseId] = useState(initial?.caseId ?? presetCaseId ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [photos, setPhotos] = useState<FieldReportPhoto[]>(initial?.photos ?? []);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [isPending, startTransition] = useTransition();

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

    const prepared = await Promise.all(validFiles.map((f) => compressPhoto(f)));

    const results = await Promise.all(
      prepared.map(async (f) => {
        const fd = new FormData();
        fd.set("file", f);
        const res = await uploadPhotoAction(fd);
        setUploadProgress((p) => ({ ...p, done: p.done + 1 }));
        return res;
      })
    );

    const newPhotos: FieldReportPhoto[] = [];
    let firstError: string | null = null;
    for (const r of results) {
      if (r.ok && r.path) newPhotos.push({ path: r.path, caption: "" });
      else if (!r.ok && !firstError) firstError = r.error;
    }
    if (newPhotos.length) setPhotos((arr) => [...arr, ...newPhotos]);
    if (firstError) setError(firstError);
    setUploading(false);
    setUploadProgress({ done: 0, total: 0 });
  }

  function removePhoto(idx: number) {
    setPhotos((arr) => arr.filter((_, i) => i !== idx));
  }

  function setCaption(idx: number, caption: string) {
    setPhotos((arr) => arr.map((p, i) => (i === idx ? { ...p, caption } : p)));
  }

  function submit() {
    setError(null);
    if (!caseId) {
      setError("請選案場");
      return;
    }
    if (!note.trim() && photos.length === 0) {
      setError("至少要寫文字或加照片");
      return;
    }

    startTransition(async () => {
      const payload = { caseId, note, photos };
      const res = reportId
        ? await updateFieldReportAction({ ...payload, reportId })
        : await createFieldReportAction(payload);
      if (!res.ok) {
        setError(res.error ?? "儲存失敗");
        return;
      }
      router.push(`/field-reports/${res.reportId}`);
    });
  }

  return (
    <div className="space-y-6">
      <Section title="案場">
        {cases.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            目前沒有可用案場。請辦公室助理先開案。
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
                  onChange={() => setCaseId(c.id)}
                  className="mt-1 size-5 shrink-0 cursor-pointer accent-[#A07850]"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-muted-foreground">
                    {c.code ?? "未編號"}
                  </div>
                  <div className="text-base font-semibold text-primary md:text-lg">
                    {c.name}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
      </Section>

      <Section title="文字紀錄" hint="描述今天現場的狀況、合約外項目、需要主任處理的事">
        <textarea
          rows={5}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例:屋主臨時要求多打一道牆 / 1F 廁所地磚換款 / 中午下大雨停工 1 小時"
          className="w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
      </Section>

      <Section title={`照片${photos.length > 0 ? ` (${photos.length})` : ""}`} hint="可拍多張,每張下方可寫一句說明">
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
          <ul className="mt-3 space-y-3">
            {photos.map((p, idx) => (
              <li
                key={p.path + idx}
                className="grid grid-cols-[6rem_1fr_auto] items-start gap-3 rounded-md border border-[#E0DCD6] bg-card p-3"
              >
                <div className="aspect-square overflow-hidden rounded-md border border-[#E0DCD6] bg-[#F5F1EC]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.path} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`caption-${idx}`} className="text-xs text-muted-foreground">
                    這張的說明(選填)
                  </Label>
                  <Input
                    id={`caption-${idx}`}
                    value={p.caption}
                    onChange={(e) => setCaption(idx, e.target.value)}
                    placeholder="例:屋主指示位置 / 已完成 80%"
                    className="h-10"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removePhoto(idx)}
                  className="inline-flex size-8 items-center justify-center rounded-full border border-[#E0DCD6] bg-white text-sm text-[#B91C1C] hover:bg-[#FEF2F2]"
                  aria-label="刪除這張"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {error && (
        <p className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          {error}
        </p>
      )}

      <NextStepHint tone="info">
        送出後,工地主任填日誌時會看到這筆,可以勾選整合進當日施工日誌。
      </NextStepHint>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#E0DCD6] bg-background px-4 py-4 md:static md:mx-0 md:rounded-md md:border md:bg-card md:px-5">
        <Button asChild variant="ghost" type="button">
          <Link href="/field-reports">取消</Link>
        </Button>
        <Button
          type="button"
          onClick={submit}
          disabled={isPending || uploading}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {isPending ? "送出中…" : reportId ? "儲存變更" : "送出回報"}
        </Button>
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
