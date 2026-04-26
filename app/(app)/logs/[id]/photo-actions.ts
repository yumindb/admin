"use server";

import { createClient } from "@/lib/supabase/server";

const BUCKET = "daily-photos";

/**
 * 上傳一張照片到 Supabase Storage,回傳 public URL。
 * POC:bucket 設為 public,方便直接顯示。正式版改 private + signed URL。
 */
export async function uploadPhotoAction(formData: FormData) {
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

const SIG_BUCKET = "signatures";

/** 老闆簽名圖上傳(dataURL → png) */
export async function uploadSignatureAction(formData: FormData) {
  const dataUrl = String(formData.get("dataUrl") ?? "");
  if (!dataUrl.startsWith("data:image/")) {
    return { ok: false as const, error: "簽名格式錯誤" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "未登入" };

  const m = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!m) return { ok: false as const, error: "解析失敗" };
  const contentType = m[1];
  const buf = Buffer.from(m[2], "base64");

  const path = `${user.id}/${Date.now()}.png`;
  const { error: upErr } = await supabase.storage
    .from(SIG_BUCKET)
    .upload(path, buf, { contentType, upsert: false });
  if (upErr) return { ok: false as const, error: "上傳失敗:" + upErr.message };

  const { data } = supabase.storage.from(SIG_BUCKET).getPublicUrl(path);
  return { ok: true as const, path: data.publicUrl };
}
