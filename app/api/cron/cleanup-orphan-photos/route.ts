import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// Vercel Functions 預設 10 秒 timeout;掃 bucket + 兩張表 + 分批刪除
// 在資料量大時容易超時。Hobby 上限 60 秒,設到上限。
export const maxDuration = 60;

/**
 * 清理 daily-photos bucket 內的孤兒照片。
 *
 * 觸發:每天台灣時間 23:30 由 Vercel Cron 打進來(UTC 15:30,見 vercel.json)。
 *
 * 「孤兒」定義:
 *   - 上傳時間超過 24 小時(避免誤殺正在編輯中的草稿)
 *   - 沒有任何 daily_logs.photos 或 field_reports.photos 引用
 *
 * 為什麼用 24h 而不是日期切:
 *   使用者可能 23:25 上傳、23:31 才送出。用「昨天以前」這種日期界線會 race;
 *   用「>= 24h 前 + 沒被引用」就有足夠緩衝,任何已送出的記錄都會保住它的檔。
 *
 * 為什麼用 service-role:
 *   要跨所有使用者掃 bucket 與兩張表,RLS 擋的就是這種跨人讀取。
 *   API endpoint 用 CRON_SECRET 守門,只能由 Vercel Cron 觸發。
 */

const BUCKET = "daily-photos";
// 兩種 URL 格式都要吃: public(歷史)/ sign(轉 private 後新存的)
const PUBLIC_MARKER = `/object/public/${BUCKET}/`;
const SIGN_MARKER = `/object/sign/${BUCKET}/`;
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
const DELETE_BATCH = 100;

export async function GET(request: Request) {
  // Vercel Cron 會帶 Authorization: Bearer ${CRON_SECRET}
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "未授權" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const cutoff = Date.now() - ORPHAN_AGE_MS;

  // 1) 列出 bucket 內所有檔案。儲存結構是 `{userId}/{filename}`,
  //    storage.list 一次列一層,所以先列根目錄拿 user folders、再列每個 folder。
  //
  //    分頁保險(W4-5): 兩層都用 offset while-loop 直到 < 1000 筆。
  //    根目錄上限是 user folder 數;>1000 user 時也吃得下。
  //    每個 folder 的分頁同樣到 < 1000 才停。
  const PAGE = 1000;
  const userFolders: string[] = [];
  {
    let offset = 0;
    while (true) {
      const { data: rootEntries, error: rootErr } = await supabase.storage
        .from(BUCKET)
        .list("", { limit: PAGE, offset });
      if (rootErr) {
        return NextResponse.json(
          { ok: false, error: "list root: " + rootErr.message },
          { status: 500 }
        );
      }
      if (!rootEntries || rootEntries.length === 0) break;
      for (const entry of rootEntries) {
        // folder entry 在 Supabase storage 通常 id 是 null
        if (entry.id !== null) continue;
        userFolders.push(entry.name);
      }
      if (rootEntries.length < PAGE) break;
      offset += rootEntries.length;
    }
  }

  const oldFilePaths: string[] = [];
  for (const folder of userFolders) {
    let offset = 0;
    while (true) {
      const { data: files, error: lsErr } = await supabase.storage
        .from(BUCKET)
        .list(folder, { limit: PAGE, offset });
      if (lsErr) {
        return NextResponse.json(
          { ok: false, error: `list ${folder}: ${lsErr.message}` },
          { status: 500 }
        );
      }
      if (!files || files.length === 0) break;
      for (const f of files) {
        if (f.id === null) continue; // 子資料夾,目前沒用到
        const created = f.created_at ? new Date(f.created_at).getTime() : Date.now();
        if (created > cutoff) continue; // 太新,先放過
        oldFilePaths.push(`${folder}/${f.name}`);
      }
      if (files.length < PAGE) break;
      offset += files.length;
    }
  }

  // 2) 撈所有被引用的 path(從兩張表的 photos jsonb)
  const referenced = new Set<string>();
  const { data: logRows, error: logErr } = await supabase
    .from("daily_logs")
    .select("photos");
  if (logErr) {
    return NextResponse.json(
      { ok: false, error: "select daily_logs: " + logErr.message },
      { status: 500 }
    );
  }
  const { data: reportRows, error: repErr } = await supabase
    .from("field_reports")
    .select("photos");
  if (repErr) {
    return NextResponse.json(
      { ok: false, error: "select field_reports: " + repErr.message },
      { status: 500 }
    );
  }
  for (const r of [...(logRows ?? []), ...(reportRows ?? [])]) {
    collectPaths(r.photos, referenced);
  }

  // 3) 比對:bucket 中超過 24h 但 DB 沒引用的就是孤兒
  const orphans = oldFilePaths.filter((p) => !referenced.has(p));

  // 4) 分批刪除(Supabase remove 沒明文上限,保守 100 個一批)
  let deleted = 0;
  const failed: string[] = [];
  for (let i = 0; i < orphans.length; i += DELETE_BATCH) {
    const batch = orphans.slice(i, i + DELETE_BATCH);
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(batch);
    if (rmErr) {
      failed.push(`batch ${i}: ${rmErr.message}`);
    } else {
      deleted += batch.length;
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: oldFilePaths.length,
    referenced: referenced.size,
    orphans: orphans.length,
    deleted,
    failed,
    ranAt: new Date().toISOString(),
  });
}

/** 從 photos jsonb 取出所有 storage path。容忍兩種格式:
 *  - 新格式 { path: string, caption?: string }
 *  - 舊格式 string(直接是 URL,migration-2.7 之前) */
function collectPaths(photos: unknown, out: Set<string>) {
  if (!Array.isArray(photos)) return;
  for (const item of photos) {
    let url: string | null = null;
    if (typeof item === "string") url = item;
    else if (item && typeof item === "object" && "path" in item) {
      const p = (item as { path: unknown }).path;
      if (typeof p === "string") url = p;
    }
    if (!url) continue;
    let path: string | null = null;
    for (const marker of [PUBLIC_MARKER, SIGN_MARKER]) {
      const idx = url.indexOf(marker);
      if (idx >= 0) {
        const after = url.slice(idx + marker.length);
        const q = after.indexOf("?");
        path = q >= 0 ? after.slice(0, q) : after;
        break;
      }
    }
    // 沒命中 marker → 視為裸 storage path(未來格式)
    if (!path) path = url;
    if (path) out.add(path);
  }
}
