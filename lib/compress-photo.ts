/**
 * 照片上傳前的 client 端壓縮（現場回報表單 + 施工日誌表單共用）。
 *
 * 為什麼在 client 壓：工地手機拍的原檔動輒 4〜12MB，直接上傳吃流量又會撞
 * server 端 8MB 上限（2026-08 業主回報：超過 8MB 的照片被整張跳過）。
 * 先縮到長邊 1600px 轉存 JPEG，大小會落在幾百 KB，超大原檔也送得出去。
 */

/** 與 server 端 uploadPhotoAction 的上限一致（app/(app)/logs/[id]/photo-actions.ts） */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

// 已經夠小就不重壓，避免小圖畫質白白降一次
const SKIP_BELOW_BYTES = 1.2 * 1024 * 1024;
const MAX_SIDE = 1600;
// 一般照片第一檔就夠；極端尺寸／高雜訊的圖壓不進 8MB 時逐檔降畫質再試
const QUALITY_STEPS = [0.82, 0.7, 0.55];

export type PreparedPhoto =
  | { ok: true; file: File }
  | { ok: false; error: string };

/**
 * 壓縮單張照片給上傳用。壓完（或瀏覽器壓不了）仍超過 8MB 才回 ok:false，
 * 呼叫端負責 toast＋跳過；ok:true 的檔案保證在上限內。
 */
export async function preparePhotoForUpload(file: File): Promise<PreparedPhoto> {
  const compressed = await compressPhoto(file);
  if (compressed.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `照片 ${file.name} 壓縮後仍超過 8MB` };
  }
  return { ok: true, file: compressed };
}

export async function compressPhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= SKIP_BELOW_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    let blob: Blob | null = null;
    for (const quality of QUALITY_STEPS) {
      blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", quality);
      });
      if (blob && blob.size <= MAX_UPLOAD_BYTES) break;
    }
    if (!blob) return file;
    // 壓完反而變大（小圖或已高度壓縮的圖）就用原檔；但原檔本身超過上限時
    // 寧可用壓過的版本 — 至少送得出去
    if (blob.size >= file.size && file.size <= MAX_UPLOAD_BYTES) return file;

    const nextName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], nextName, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
