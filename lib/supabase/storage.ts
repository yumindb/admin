import { createServiceClient } from "@/lib/supabase/server";

/**
 * Signed URL 預設有效期(秒)— 5 分鐘。
 * 頁面 SSR 完帶到 client 顯示,使用者讀完通常已關頁面。
 */
const DEFAULT_TTL = 300;

/**
 * 從輸入(可能是完整 public URL 或單純 storage path)抽出 storage path。
 *
 * 歷史: POC 階段 daily-photos / signatures 為 public bucket,所以前端把
 *       `getPublicUrl()` 回傳的完整 URL 直接寫進 daily_logs.photos[].path /
 *       log_approvals.signature_url。轉 private + signed URL 後,新存的
 *       upload action 會回 path,但歷史資料仍是完整 URL。這個 helper 同
 *       時吃兩種輸入,讓 UI 端不需要改 schema。
 *
 * 規則:
 *   - 如果是 `https://.../storage/v1/object/public/{bucket}/{path}` → 抽出 {path}
 *     (signed URL 也走同 marker `/object/sign/` — 但 signed 已過期就直接回 input,
 *      讓上層用 `getSignedUrl(path)` 重新籤)
 *   - 否則視為已是 storage path 原樣回
 */
export function extractStoragePath(input: string, bucket: string): string {
  if (!input) return input;
  const publicMarker = `/object/public/${bucket}/`;
  const signMarker = `/object/sign/${bucket}/`;
  for (const marker of [publicMarker, signMarker]) {
    const idx = input.indexOf(marker);
    if (idx >= 0) {
      const after = input.slice(idx + marker.length);
      // signed URL 帶 `?token=...`,要砍掉
      const q = after.indexOf("?");
      return q >= 0 ? after.slice(0, q) : after;
    }
  }
  return input;
}

/**
 * 一次撈多個 path 的 signed URL,回傳 Map<input, signedUrl>。
 *
 * - input 可以是完整 URL(歷史資料)或 storage path(新資料)。回傳的 Map
 *   key 用「原始 input」,讓呼叫端可以 `map.get(p.path)` 直接拿到。
 * - 用 service-role client(因 server-side 要繞過 RLS;且 createSignedUrl
 *   需要 bucket-level 權限,anon 拿不到)。
 * - 若簽名失敗,該 path 在 Map 中缺席,呼叫端自行處理 fallback(不顯示 / 顯示 placeholder)。
 *
 * @param bucket 'daily-photos' / 'signatures'
 * @param inputs 同一個 bucket 內的 paths(或舊資料的完整 URL)
 * @param ttl 簽名有效秒數;預設 300(5 min)
 */
export async function getSignedUrls(
  bucket: string,
  inputs: string[],
  ttl: number = DEFAULT_TTL
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!inputs.length) return out;

  // 先 normalize → path,留 input → path 對應表
  const inputToPath = new Map<string, string>();
  const paths: string[] = [];
  for (const i of inputs) {
    if (!i) continue;
    const p = extractStoragePath(i, bucket);
    if (!p) continue;
    inputToPath.set(i, p);
    if (!paths.includes(p)) paths.push(p);
  }
  if (!paths.length) return out;

  // env var 未設 / service-role 建構失敗時不要炸頁面,回空 map 讓 UI 顯示 placeholder
  let supabase;
  try {
    supabase = createServiceClient();
  } catch (err) {
    console.error("[storage] createServiceClient failed:", err);
    return out;
  }
  let data, error;
  try {
    ({ data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(paths, ttl));
  } catch (err) {
    console.error("[storage] createSignedUrls threw:", err);
    return out;
  }
  if (error || !data) {
    if (error) console.error("[storage] createSignedUrls error:", error);
    return out;
  }

  // path → signedUrl
  const pathToSigned = new Map<string, string>();
  for (const row of data) {
    if (row.signedUrl && row.path) {
      pathToSigned.set(row.path, row.signedUrl);
    }
  }

  // input → signedUrl
  for (const [input, path] of inputToPath) {
    const signed = pathToSigned.get(path);
    if (signed) out.set(input, signed);
  }
  return out;
}

/**
 * 單一 path 取 signed URL。失敗回 null。
 */
export async function getSignedUrl(
  bucket: string,
  input: string,
  ttl: number = DEFAULT_TTL
): Promise<string | null> {
  const map = await getSignedUrls(bucket, [input], ttl);
  return map.get(input) ?? null;
}
