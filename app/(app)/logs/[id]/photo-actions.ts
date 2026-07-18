"use server";

import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { extractStoragePath, getSignedUrl } from "@/lib/supabase/storage";

const BUCKET = "daily-photos";

/**
 * 表單預覽用 signed URL 的效期 — 6 小時。
 *
 * 頁面顯示用的 5 分鐘預設(storage.ts DEFAULT_TTL)對「編輯中的表單」不夠:
 * 主任會開著日誌表單慢慢填,草稿也會把這個 URL 存進 localStorage,
 * 過期就整片破圖。6h 蓋掉整個工作天;隔天回來的草稿由
 * refreshPhotoUrlsAction 整批重簽。
 */
const PREVIEW_TTL = 6 * 60 * 60;

/**
 * 上傳一張照片到 Supabase Storage,回傳 signed URL(6h)用於 client 即時預覽。
 *
 * Bucket 已轉 private(migration-2.10),`getPublicUrl` 不可用。Client 拿到的
 * `path` 欄位實質是「signed URL」,送出後存進 daily_logs.photos[].path。
 * 後續顯示用 `getSignedUrls()` helper 重新籤,它能從 signed URL 抽出
 * storage path。
 */
export async function uploadPhotoAction(formData: FormData) {
  await requireRole([
    "site_supervisor",
    "office_staff",
    "owner",
    "field_assistant",
  ]);

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false as const, error: "未提供檔案" };
  if (!file.type.startsWith("image/")) {
    return { ok: false as const, error: "不是圖片檔" };
  }
  if (file.size > 8 * 1024 * 1024) {
    return { ok: false as const, error: "圖片超過 8MB" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "未登入" };

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `${user.id}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;

  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, buf, {
      contentType: file.type,
      upsert: false,
    });
  if (upErr) return { ok: false as const, error: "上傳失敗：" + upErr.message };

  // bucket 已私有 — 回 signed URL 給 client 即時預覽。
  // helper 用 service-role client,bypass RLS。
  const signed = await getSignedUrl(BUCKET, path, PREVIEW_TTL);
  if (!signed) {
    return { ok: false as const, error: "簽名失敗" };
  }
  return { ok: true as const, path: signed };
}

/**
 * 整批重簽照片預覽 URL — 給「還原 localStorage 草稿」用。
 *
 * 草稿存的是 signed URL,效期(6h)一過縮圖就整片破圖;還原時把舊 URL
 * 丟進來換新的。回傳的 map 缺席 = 檔案已不存在(通常是超過 72h 未送出、
 * 被 cleanup-orphan-photos cron 清掉),呼叫端應把該張從草稿移除並提醒。
 *
 * 安全:限已登入角色;path 含上傳者 UUID + 亂數,無法枚舉;
 * 只服務 daily-photos bucket。
 */
export async function refreshPhotoUrlsAction(urls: string[]) {
  await requireRole([
    "site_supervisor",
    "office_staff",
    "owner",
    "field_assistant",
  ]);

  if (!Array.isArray(urls) || urls.length === 0) {
    return {
      ok: true as const,
      urls: {} as Record<string, string>,
      missing: [] as string[],
    };
  }
  // 一份日誌照片頂多幾十張;超過就是異常呼叫
  const capped = urls.filter((u) => typeof u === "string" && u).slice(0, 120);

  // 不走 getSignedUrls helper:它把逐檔錯誤吞掉,這裡需要區分
  // 「檔案已不存在」(該從草稿移除)和「簽名服務失敗」(該保留原 URL)
  let supabase;
  try {
    supabase = createServiceClient();
  } catch {
    return { ok: false as const, error: "重簽失敗" };
  }
  const pathByInput = new Map(
    capped.map((u) => [u, extractStoragePath(u, BUCKET)]),
  );
  const paths = [...new Set(pathByInput.values())].filter(Boolean);
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, PREVIEW_TTL);
  if (error || !data) {
    return { ok: false as const, error: "重簽失敗" };
  }
  const signedByPath = new Map<string, string>();
  for (const row of data) {
    if (row.path && row.signedUrl) signedByPath.set(row.path, row.signedUrl);
  }
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const [input, path] of pathByInput) {
    const signed = signedByPath.get(path);
    if (signed) out[input] = signed;
    else missing.push(input); // 逐檔回報 Object not found → 檔案真的沒了
  }
  return { ok: true as const, urls: out, missing };
}

/**
 * 刪除一張尚未送出的暫存照片。傳入 uploadPhotoAction 回傳的 URL(signed 或舊 public),
 * 反推出 storage path 後從 bucket 移除。
 *
 * 安全:只允許刪自己 user folder 底下的檔(path 第一段必須等於 user.id)。
 * 用途:使用者按 × 移除照片、或按「取消」放棄表單時清掉本次階段的上傳。
 */
export async function deletePhotoAction(publicUrl: string) {
  if (typeof publicUrl !== "string" || !publicUrl) {
    return { ok: false as const, error: "未提供路徑" };
  }

  // 同時吃 public URL(舊資料)、signed URL(新)和裸 storage path(未來)
  let path: string | null = null;
  for (const marker of [
    `/object/public/${BUCKET}/`,
    `/object/sign/${BUCKET}/`,
  ]) {
    const idx = publicUrl.indexOf(marker);
    if (idx >= 0) {
      const after = publicUrl.slice(idx + marker.length);
      const q = after.indexOf("?");
      path = q >= 0 ? after.slice(0, q) : after;
      break;
    }
  }
  // 沒命中 marker → 視作裸 path
  if (!path) path = publicUrl;
  if (!path) return { ok: false as const, error: "URL 缺少路徑" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "未登入" };

  // 路徑格式為 `{userId}/{filename}`,只允許刪自己的
  const ownerId = path.split("/")[0];
  if (ownerId !== user.id) {
    return { ok: false as const, error: "無權限刪除此檔" };
  }

  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) return { ok: false as const, error: "刪除失敗：" + error.message };
  return { ok: true as const };
}

const SIG_BUCKET = "signatures";

const SignatureDataUrlSchema = z
  .string()
  .regex(
    /^data:image\/(png|jpeg);base64,/,
    "簽名格式錯誤"
  );

/** 老闆簽名圖上傳(dataURL → png) */
export async function uploadSignatureAction(formData: FormData) {
  await requireRole(["site_supervisor", "office_staff", "owner"]);

  const dataUrl = String(formData.get("dataUrl") ?? "");
  const parsed = SignatureDataUrlSchema.safeParse(dataUrl);
  if (!parsed.success) {
    return { ok: false as const, error: "簽名格式錯誤" };
  }

  const m = dataUrl.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/);
  if (!m) return { ok: false as const, error: "解析失敗" };
  const contentType = m[1];

  // base64 length cap — 避免有人塞 5MB 的 dataURL 進來爆 storage / DB row
  if (m[2].length > 200_000) {
    return { ok: false as const, error: "簽名圖過大" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "未登入" };

  const buf = Buffer.from(m[2], "base64");

  const path = `${user.id}/${Date.now()}.png`;
  const { error: upErr } = await supabase.storage
    .from(SIG_BUCKET)
    .upload(path, buf, { contentType, upsert: false });
  if (upErr) return { ok: false as const, error: "上傳失敗：" + upErr.message };

  // signature bucket 已私有 — 回 signed URL(5 min)。
  const signed = await getSignedUrl(SIG_BUCKET, path);
  if (!signed) {
    return { ok: false as const, error: "簽名失敗" };
  }
  return { ok: true as const, path: signed };
}
