"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CasePicker, type CasePickerOption } from "@/components/case-picker";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { deletePhotoAction, uploadPhotoAction } from "../logs/[id]/photo-actions";
import { createFieldReportAction, updateFieldReportAction } from "./actions";
import { NextStepHint } from "@/components/next-step-hint";
import type { FieldReportPhoto } from "@/lib/types";

export type CaseOption = CasePickerOption;

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

/**
 * 現場工人填回報用 — 一頁式、大按鈕、極簡步驟。
 * 1) 選案場 (彈出 sheet)
 * 2) 寫文字 (大 textarea,可空)
 * 3) 加照片 (大按鈕;每張可寫一句)
 * 4) 送出
 */
export function NewReportForm({ cases, presetCaseId, reportId, initial }: Props) {
  const router = useRouter();
  const [caseId, setCaseId] = useState(initial?.caseId ?? presetCaseId ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [photos, setPhotos] = useState<FieldReportPhoto[]>(initial?.photos ?? []);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [isPending, startTransition] = useTransition();
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);
  // 本次階段上傳到 Storage 的 path,使用者按 × 時要連 Storage 一起刪。
  const sessionUploadsRef = useRef<Set<string>>(new Set());

  async function onPickPhotos(files: FileList | null) {
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
    setProgress({ done: 0, total: validFiles.length });

    const prepared = await Promise.all(validFiles.map((f) => compressPhoto(f)));

    const results = await Promise.all(
      prepared.map(async (f) => {
        const fd = new FormData();
        fd.set("file", f);
        const res = await uploadPhotoAction(fd);
        setProgress((p) => ({ ...p, done: p.done + 1 }));
        return res;
      })
    );

    const newPhotos: FieldReportPhoto[] = [];
    let firstError: string | null = null;
    for (const r of results) {
      if (r.ok && r.path) newPhotos.push({ path: r.path, caption: "" });
      else if (!r.ok && !firstError) firstError = r.error;
    }
    if (newPhotos.length) {
      for (const p of newPhotos) sessionUploadsRef.current.add(p.path);
      setPhotos((arr) => [...arr, ...newPhotos]);
    }
    if (firstError) setError(firstError);
    setUploading(false);
    setProgress({ done: 0, total: 0 });
  }

  function removePhoto(idx: number) {
    const target = photos[idx];
    setPhotos((arr) => arr.filter((_, i) => i !== idx));
    if (target && sessionUploadsRef.current.has(target.path)) {
      sessionUploadsRef.current.delete(target.path);
      void deletePhotoAction(target.path);
    }
  }

  function setCaption(idx: number, caption: string) {
    setPhotos((arr) => arr.map((p, i) => (i === idx ? { ...p, caption } : p)));
  }

  function submit() {
    setError(null);
    if (!caseId) {
      setError("請先選案場");
      return;
    }
    if (!note.trim() && photos.length === 0) {
      setError("至少寫幾個字或加一張照片");
      return;
    }

    startTransition(async () => {
      const payload = { caseId, note, photos };
      const res = reportId
        ? await updateFieldReportAction({ ...payload, reportId })
        : await createFieldReportAction(payload);
      if (!res.ok) {
        setError(res.error ?? "送出失敗");
        return;
      }
      router.push(`/field-reports/${res.reportId}`);
    });
  }

  const canSubmit = !!caseId && (note.trim().length > 0 || photos.length > 0);

  return (
    <div className="space-y-5">
      {/* 1. 案場 */}
      <CasePicker cases={cases} value={caseId} onChange={setCaseId} />

      {/* 2. 文字 */}
      <textarea
        rows={5}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="今天現場有什麼狀況?(選填)&#10;例:屋主要多打一道牆 / 1F 廁所地磚要換款"
        className="block w-full resize-y rounded-lg border-2 border-[#E0DCD6] bg-white px-4 py-4 text-lg leading-relaxed outline-none focus-visible:border-accent"
      />

      {/* 3. 照片 — 大按鈕 */}
      <label className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-lg border-2 border-dashed border-[#A07850]/50 bg-[#FAF7F2] px-5 py-6 text-center transition-colors hover:border-[#A07850] hover:bg-[#F5F1EC] active:bg-[#F0EBE4]">
        <span className="text-3xl" aria-hidden>📷</span>
        <span className="text-xl font-semibold text-primary">
          {uploading
            ? `上傳中… ${progress.done}/${progress.total}`
            : photos.length > 0
              ? "再加照片"
              : "拍照 / 加照片"}
        </span>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => onPickPhotos(e.target.files)}
          disabled={uploading}
          className="sr-only"
        />
      </label>

      {photos.length > 0 && (
        <ul className="space-y-3">
          {photos.map((p, idx) => (
            <li
              key={p.path + idx}
              className="overflow-hidden rounded-lg border-2 border-[#E0DCD6] bg-card"
            >
              <div className="relative bg-[#F5F1EC]">
                <button
                  type="button"
                  onClick={() => setLightboxPath(p.path)}
                  className="block h-40 w-full cursor-zoom-in"
                  aria-label="放大檢視"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.path}
                    alt=""
                    className="mx-auto block h-40 w-full object-contain"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => removePhoto(idx)}
                  className="absolute right-2 top-2 inline-flex size-10 items-center justify-center rounded-full bg-black/70 text-2xl text-white shadow-md hover:bg-black/85 active:bg-black"
                  aria-label="刪除這張"
                >
                  ×
                </button>
              </div>
              <input
                value={p.caption}
                onChange={(e) => setCaption(idx, e.target.value)}
                placeholder="(選填) 這張照片想說什麼?"
                className="block w-full border-t-2 border-[#E0DCD6] bg-white px-4 py-3 text-base outline-none focus-visible:border-accent"
              />
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="rounded-lg border-2 border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-base text-[#B91C1C]">
          {error}
        </p>
      )}

      {!reportId && (
        <NextStepHint tone="info">
          送出後工地主任填日誌時會看到，可勾選併入。pending 時還能編輯／刪除。
        </NextStepHint>
      )}

      {/* 4. 送出 — sticky 緊貼底部 tab bar 上緣 */}
      <div
        className="sticky -mx-4 mt-6 border-t border-[#E0DCD6] bg-background px-4 py-4 shadow-[0_-2px_8px_rgba(0,0,0,0.04)] md:bottom-0 md:mx-0 md:rounded-lg md:border-2 md:bg-card md:px-5 md:shadow-none"
        style={{ bottom: "calc(67px + env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || isPending || uploading}
          className="block h-16 w-full rounded-lg bg-primary text-xl font-semibold text-primary-foreground shadow-md transition-all hover:bg-primary/90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          {isPending ? "送出中…" : reportId ? "儲存變更" : "送出回報"}
        </button>
      </div>

      <PhotoLightbox
        photos={photos.map((p) => p.path)}
        path={lightboxPath}
        onChange={setLightboxPath}
      />
    </div>
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
