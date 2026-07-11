"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CasePicker, type CasePickerOption } from "@/components/case-picker";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { deletePhotoAction, uploadPhotoAction } from "../logs/[id]/photo-actions";
import { createFieldReportAction, updateFieldReportAction } from "./actions";
import { NextStepHint } from "@/components/next-step-hint";
import { useSilentLocationOnce } from "@/lib/use-geolocation";
import { evaluateGeofence } from "@/lib/geo";
import { isOfflineErrorMessage } from "@/lib/offline-clock-queue";
import {
  enqueueReport,
  listPendingReports,
  removeReport,
  bumpReportAttempts,
  MAX_REPORT_ATTEMPTS,
  type PendingReport,
} from "@/lib/offline-report-queue";
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

// localStorage key prefix:
// - new: yumin-fr-draft-new
// - edit: yumin-fr-draft-<reportId>
// 每個 reportId 各存自己,避免新表單還原時撞到編輯草稿
const DRAFT_KEY_PREFIX = "yumin-fr-draft-";

type DraftPayload = {
  caseId: string;
  note: string;
  photos: FieldReportPhoto[];
};

function readDraft(key: string): DraftPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw) as DraftPayload;
    if (typeof obj?.caseId !== "string" || typeof obj?.note !== "string") return null;
    if (!Array.isArray(obj.photos)) return null;
    return obj;
  } catch {
    return null;
  }
}

/**
 * 現場工人填回報用 — 一頁式、大按鈕、極簡步驟。
 * 1) 選案場 (彈出 sheet)
 * 2) 寫文字 (大 textarea,可空)
 * 3) 加照片 (大按鈕;每張可寫一句)
 * 4) 送出 — 若離線會自動進 IndexedDB queue,連線回來自動送
 */
export function NewReportForm({ cases, presetCaseId, reportId, initial }: Props) {
  const router = useRouter();
  const draftKey = `${DRAFT_KEY_PREFIX}${reportId ?? "new"}`;
  const [caseId, setCaseId] = useState(initial?.caseId ?? presetCaseId ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [photos, setPhotos] = useState<FieldReportPhoto[]>(initial?.photos ?? []);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [isPending, startTransition] = useTransition();
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [autosaved, setAutosaved] = useState(false);
  // 本次階段上傳到 Storage 的 path,使用者按 × 時要連 Storage 一起刪。
  const sessionUploadsRef = useRef<Set<string>>(new Set());
  // 隱式 GPS 戳記:已授權才靜默取(未授權不彈視窗、不擋送出)
  const silentLoc = useSilentLocationOnce();

  // 人已在某工地範圍內 → 自動選好該案場(跟打卡頁的自動推薦同一套邏輯)。
  // 只在草稿還原完、沒有 preset、使用者也還沒自己選時做一次;選錯隨時可改。
  const autoPickedRef = useRef(false);
  useEffect(() => {
    if (autoPickedRef.current || !hydrated || !silentLoc || caseId || reportId) return;
    const candidates = cases
      .map((c) => ({
        id: c.id,
        ev: evaluateGeofence(
          {
            lat: c.lat ?? null,
            lng: c.lng ?? null,
            geofence_radius_m: c.geofence_radius_m ?? 300,
          },
          { lat: silentLoc.lat, lng: silentLoc.lng },
        ),
      }))
      .filter((x) => x.ev.withinGeofence && x.ev.distanceM !== null)
      .sort((a, b) => (a.ev.distanceM ?? 0) - (b.ev.distanceM ?? 0));
    if (candidates.length > 0) {
      autoPickedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 同步外部系統(GPS)的一次性預選
      setCaseId(candidates[0].id);
    }
  }, [hydrated, silentLoc, caseId, reportId, cases]);

  // 離線排隊狀態(僅新建時走 queue;編輯不排隊 — 已存在的 record 等連線好再改即可)
  const [pending, setPending] = useState<PendingReport[]>([]);
  const [flushing, setFlushing] = useState(false);

  // Mount: 還原草稿 + 撈離線佇列 + 嘗試 flush
  useEffect(() => {
    const draft = readDraft(draftKey);
    if (draft) {
      // 新表單才還原草稿;編輯模式以 server initial 為準
      if (!reportId) {
        if (draft.caseId) setCaseId(draft.caseId);
        if (draft.note) setNote(draft.note);
        if (draft.photos.length) setPhotos(draft.photos);
        setAutosaved(true);
      }
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshPending = useCallback(async () => {
    try {
      const list = await listPendingReports();
      setPending(list);
    } catch {
      // IndexedDB 不可用 → 靜默,離線排隊不可用
    }
  }, []);

  const flushQueue = useCallback(async () => {
    if (flushing) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    setFlushing(true);
    try {
      const list = await listPendingReports();
      for (const item of list) {
        if (item.attempts >= MAX_REPORT_ATTEMPTS) continue;
        try {
          const res = await createFieldReportAction({
            caseId: item.case_id,
            note: item.note,
            photos: item.photos,
            submitLocation:
              item.submit_lat !== null && item.submit_lng !== null
                ? {
                    lat: item.submit_lat,
                    lng: item.submit_lng,
                    accuracy_m: item.submit_accuracy_m,
                  }
                : null,
          });
          if (res.ok) {
            await removeReport(item.id);
          } else {
            // server validation 失敗 — 不會再成功,記下 + 停止重試
            await bumpReportAttempts(item.id, res.error ?? "未知錯誤");
          }
        } catch (e) {
          await bumpReportAttempts(item.id, (e as Error).message ?? "未知錯誤");
        }
      }
      await refreshPending();
      router.refresh();
    } finally {
      setFlushing(false);
    }
  }, [flushing, refreshPending, router]);

  useEffect(() => {
    void refreshPending();
    void flushQueue();
    const handler = () => {
      void flushQueue();
    };
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce 寫 localStorage(等 hydrated 才開始)
  useEffect(() => {
    if (!hydrated || reportId) return; // 編輯模式不存草稿
    const t = setTimeout(() => {
      try {
        if (!caseId && !note && photos.length === 0) {
          localStorage.removeItem(draftKey);
          setAutosaved(false);
          return;
        }
        localStorage.setItem(
          draftKey,
          JSON.stringify({ caseId, note, photos } satisfies DraftPayload),
        );
        setAutosaved(true);
      } catch {
        // quota exceeded — 靜默
      }
    }, 400);
    return () => clearTimeout(t);
  }, [hydrated, reportId, draftKey, caseId, note, photos]);

  async function onPickPhotos(files: FileList | null) {
    if (!files?.length) return;
    const validFiles = Array.from(files).filter((f) => {
      if (!f.type.startsWith("image/")) return false;
      if (f.size > 8 * 1024 * 1024) {
        toast.error(`照片 ${f.name} 超過 8MB`, { description: "已跳過此張" });
        return false;
      }
      return true;
    });
    if (!validFiles.length) return;

    setUploading(true);
    setProgress({ done: 0, total: validFiles.length });

    const prepared = await Promise.all(validFiles.map((f) => compressPhoto(f)));

    const results = await Promise.all(
      prepared.map(async (f) => {
        const fd = new FormData();
        fd.set("file", f);
        try {
          const res = await uploadPhotoAction(fd);
          setProgress((p) => ({ ...p, done: p.done + 1 }));
          return res;
        } catch (e) {
          setProgress((p) => ({ ...p, done: p.done + 1 }));
          return {
            ok: false as const,
            error: (e as Error).message ?? "上傳失敗",
          };
        }
      })
    );

    const newPhotos: FieldReportPhoto[] = [];
    let firstError: string | null = null;
    let failedCount = 0;
    for (const r of results) {
      if (r.ok && r.path) newPhotos.push({ path: r.path, caption: "" });
      else if (!r.ok) {
        failedCount += 1;
        if (!firstError) firstError = r.error;
      }
    }
    if (newPhotos.length) {
      for (const p of newPhotos) sessionUploadsRef.current.add(p.path);
      setPhotos((arr) => [...arr, ...newPhotos]);
    }
    if (firstError) {
      const isOffline = isOfflineErrorMessage(firstError);
      toast.error(
        failedCount > 1 ? `${failedCount} 張照片上傳失敗` : "照片上傳失敗",
        {
          description: isOffline
            ? "目前訊號不穩，連上網路後再加一次照片"
            : firstError,
        },
      );
    }
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

  function clearDraft() {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
  }

  async function queueOffline(reason: string) {
    try {
      await enqueueReport({
        case_id: caseId,
        note,
        photos,
        submit_lat: silentLoc?.lat ?? null,
        submit_lng: silentLoc?.lng ?? null,
        submit_accuracy_m: silentLoc?.accuracy_m ?? null,
      });
      await refreshPending();
      toast.warning("回報已離線存檔", {
        description: `${reason} — 連上網路會自動送出`,
      });
      // 排隊成功 — 清掉表單 + 草稿讓使用者繼續寫下一筆
      clearDraft();
      setCaseId("");
      setNote("");
      setPhotos([]);
      sessionUploadsRef.current.clear();
    } catch {
      toast.error("離線排隊失敗", {
        description: "此瀏覽器不支援 IndexedDB — 請連上 wifi / 換瀏覽器再試",
      });
    }
  }

  function submit() {
    if (!caseId) {
      toast.error("請先選案場");
      return;
    }
    if (!note.trim() && photos.length === 0) {
      toast.error("請至少寫幾個字或加一張照片");
      return;
    }

    // 顯式離線:不打 server 直接排隊(只在新建時排;編輯不適用)
    if (!reportId && typeof navigator !== "undefined" && !navigator.onLine) {
      void queueOffline("目前離線");
      return;
    }

    startTransition(async () => {
      // 僅「建立」時帶 submitLocation;更新時不重寫(保留原始位置)
      const submitLocation = silentLoc
        ? { lat: silentLoc.lat, lng: silentLoc.lng, accuracy_m: silentLoc.accuracy_m }
        : null;
      const payload = { caseId, note, photos };
      try {
        const res = reportId
          ? await updateFieldReportAction({ ...payload, reportId })
          : await createFieldReportAction({ ...payload, submitLocation });
        if (!res.ok) {
          toast.error(res.error ?? "送出失敗");
          return;
        }
        toast.success(reportId ? "回報已更新" : "回報已送出");
        clearDraft();
        router.push(`/field-reports/${res.reportId}`);
      } catch (e) {
        const msg = (e as Error).message ?? "未知錯誤";
        if (!reportId && isOfflineErrorMessage(msg)) {
          await queueOffline("送出失敗");
        } else {
          toast.error("送出失敗", { description: msg });
        }
      }
    });
  }

  const canSubmit = !!caseId && (note.trim().length > 0 || photos.length > 0);

  return (
    <div className="space-y-5">
      {/* 離線排隊 — 有待送出時顯示 */}
      <PendingReportsCard pending={pending} flushing={flushing} onRetry={flushQueue} />

      {/* 1. 案場 */}
      <CasePicker cases={cases} value={caseId} onChange={setCaseId} />

      {/* 2. 文字 */}
      <textarea
        rows={5}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="今天現場有什麼狀況？（選填）&#10;例：屋主要多打一道牆 / 1F 廁所地磚要換款"
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
                  className="absolute right-2 top-2 inline-flex size-11 items-center justify-center rounded-full bg-black/70 text-2xl text-white shadow-md hover:bg-black/85 active:bg-black"
                  aria-label="刪除這張"
                >
                  ×
                </button>
              </div>
              <input
                value={p.caption}
                onChange={(e) => setCaption(idx, e.target.value)}
                placeholder="（選填） 這張照片想說什麼？"
                className="block w-full border-t-2 border-[#E0DCD6] bg-white px-4 py-3 text-base outline-none focus-visible:border-accent"
              />
            </li>
          ))}
        </ul>
      )}

      {!reportId && autosaved && (
        <p className="text-center text-xs text-muted-foreground">
          ✓ 已自動暫存到此手機，下次回來會還原
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
        photos={photos}
        path={lightboxPath}
        onChange={setLightboxPath}
      />
    </div>
  );
}

function PendingReportsCard({
  pending,
  flushing,
  onRetry,
}: {
  pending: PendingReport[];
  flushing: boolean;
  onRetry: () => void;
}) {
  if (pending.length === 0) return null;
  const failed = pending.filter((p) => p.attempts >= MAX_REPORT_ATTEMPTS);
  return (
    <section className="rounded-md border border-[#FDE68A] bg-[#FFFBEB] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[#92400E]">
          離線回報待送出 （{pending.length} 筆）
          {flushing && <span className="ml-2 text-xs">送出中…</span>}
        </h3>
        <button
          type="button"
          onClick={onRetry}
          disabled={flushing}
          className="inline-flex items-center rounded-md border border-[#FDE68A] bg-white px-3 py-1 text-xs text-[#92400E] hover:bg-[#FFF7E0] disabled:opacity-50"
        >
          立即重試
        </button>
      </div>
      <ul className="space-y-1 text-xs text-[#92400E]">
        {pending.map((p) => {
          const time = new Date(p.client_created_at).toLocaleTimeString("zh-TW", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "Asia/Taipei",
          });
          const photosLabel = p.photos.length > 0 ? `,${p.photos.length} 張照片` : "";
          return (
            <li key={p.id} className="break-words">
              · {time} 建立{photosLabel}
              {p.attempts > 0 && (
                <span className="ml-1">
                  （試了 {p.attempts}/{MAX_REPORT_ATTEMPTS} 次{p.last_error ? `:${p.last_error}` : ""}）
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {failed.length > 0 && (
        <p className="mt-2 text-xs text-[#B91C1C]">
          ⚠ 有 {failed.length} 筆已重試 {MAX_REPORT_ATTEMPTS} 次失敗，請聯絡辦公室手動補登。
        </p>
      )}
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
