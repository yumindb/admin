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
  // extractStoragePath 解析不出來的(舊格式/怪 URL)不能當「檔案沒了」處理,
  // 一律保留原值讓呼叫端自行 fallback
  const looksLikeKey = (p: string) => p.includes("/") && !p.startsWith("http");
  const paths = [...new Set(pathByInput.values())].filter(
    (p) => p && looksLikeKey(p),
  );
  if (paths.length === 0) {
    return { ok: false as const, error: "重簽失敗" };
  }
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, PREVIEW_TTL);
  if (error || !data) {
    return { ok: false as const, error: "重簽失敗" };
  }
  const signedByPath = new Map<string, string>();
  const notFoundPaths = new Set<string>();
  for (const row of data) {
    if (row.path && row.signedUrl) {
      signedByPath.set(row.path, row.signedUrl);
    } else if (
      row.path &&
      /not.?found|does not exist/i.test(row.error ?? "")
    ) {
      // 只有明確 Object not found 才算「檔案真的沒了」;
      // 暫時性簽名錯誤誤判成已刪 = 把還活著的照片從草稿抹掉,不可回復
      notFoundPaths.add(row.path);
    }
  }
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const [input, path] of pathByInput) {
    const signed = signedByPath.get(path);
    if (signed) out[input] = signed;
    else if (notFoundPaths.has(path)) missing.push(input);
    // 其他情況(解析失敗/暫時性錯誤):兩個清單都不進 → 呼叫端保留原 URL
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
  // — 交給共用 extractStoragePath,避免兩份 parser 各自演化
  const path = extractStoragePath(publicUrl, BUCKET);
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

/* ================================================================
 * 簽名圖章 — 2026-07-20 Phil 提的:核定時直接「蓋」預先上傳的簽名圖,
 * 不用每次手寫,列印的 PDF 呈現正式簽名。目前限 owner(Phil 先試用,
 * 其他人要不要用一次簽的圖章他說之後再看)。
 *
 * 儲存:signatures bucket 固定路徑 `{userId}/stamp.png`(upsert 覆蓋)。
 * 蓋章:stampSignatureAction 把 stamp.png 複製成 `{userId}/{ts}-stamp.png`
 * 再回 signed URL — 簽核紀錄拿到的是獨立快照,之後換圖章不影響舊日誌
 * (簽核不可變原則,跟 attendance immutable 同一個邏輯)。
 * ================================================================ */

const STAMP_ROLES = ["owner"] as const;

function stampPath(userId: string) {
  return `${userId}/stamp.png`;
}

/** 上傳 / 更換簽名圖章。client 端已轉成 PNG(白底、寬度上限),這裡再驗一次。 */
export async function uploadSignatureStampAction(formData: FormData) {
  await requireRole([...STAMP_ROLES]);

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false as const, error: "未提供檔案" };
  if (file.type !== "image/png") {
    return { ok: false as const, error: "圖章格式錯誤（需為 PNG）" };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { ok: false as const, error: "圖章超過 2MB，請換小一點的圖" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "未登入" };

  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage
    .from(SIG_BUCKET)
    .upload(stampPath(user.id), buf, {
      contentType: "image/png",
      upsert: true,
    });
  if (upErr) return { ok: false as const, error: "上傳失敗：" + upErr.message };

  const signed = await getSignedUrl(SIG_BUCKET, stampPath(user.id), PREVIEW_TTL);
  if (!signed) return { ok: false as const, error: "簽名失敗" };
  return { ok: true as const, url: signed };
}

/** 移除簽名圖章(之後核定回到手寫)。 */
export async function deleteSignatureStampAction() {
  await requireRole([...STAMP_ROLES]);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "未登入" };

  const { error } = await supabase.storage
    .from(SIG_BUCKET)
    .remove([stampPath(user.id)]);
  if (error) return { ok: false as const, error: "移除失敗：" + error.message };
  return { ok: true as const };
}

/**
 * 蓋章:把圖章複製成本次簽核專用的快照檔,回傳 signed URL。
 * 回傳格式與 uploadSignatureAction 相同,approveStageAction 直接沿用。
 */
export async function stampSignatureAction() {
  await requireRole([...STAMP_ROLES]);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "未登入" };

  const dest = `${user.id}/${Date.now()}-stamp.png`;
  const { error: cpErr } = await supabase.storage
    .from(SIG_BUCKET)
    .copy(stampPath(user.id), dest);
  if (cpErr) {
    return {
      ok: false as const,
      error: "找不到簽名圖章，請到「我的帳號」重新上傳",
    };
  }
  const signed = await getSignedUrl(SIG_BUCKET, dest);
  if (!signed) return { ok: false as const, error: "簽名失敗" };
  return { ok: true as const, path: signed };
}

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
