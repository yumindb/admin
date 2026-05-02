"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";

const BUCKET = "daily-photos";

/**
 * 上傳一張照片到 Supabase Storage,回傳 public URL。
 * POC:bucket 設為 public,方便直接顯示。正式版改 private + signed URL。
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
  if (upErr) return { ok: false as const, error: "上傳失敗:" + upErr.message };

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { ok: true as const, path: data.publicUrl };
}

/**
 * 刪除一張尚未送出的暫存照片。傳入 uploadPhotoAction 回傳的 public URL,
 * 反推出 storage path 後從 bucket 移除。
 *
 * 安全:只允許刪自己 user folder 底下的檔(path 第一段必須等於 user.id)。
 * 用途:使用者按 × 移除照片、或按「取消」放棄表單時清掉本次階段的上傳。
 */
export async function deletePhotoAction(publicUrl: string) {
  if (typeof publicUrl !== "string" || !publicUrl) {
    return { ok: false as const, error: "未提供路徑" };
  }

  const marker = `/object/public/${BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return { ok: false as const, error: "URL 格式不符" };
  const path = publicUrl.slice(idx + marker.length);
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
  if (error) return { ok: false as const, error: "刪除失敗:" + error.message };
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
  if (upErr) return { ok: false as const, error: "上傳失敗:" + upErr.message };

  const { data } = supabase.storage.from(SIG_BUCKET).getPublicUrl(path);
  return { ok: true as const, path: data.publicUrl };
}
