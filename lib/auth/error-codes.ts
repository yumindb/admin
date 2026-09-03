/**
 * 錯誤代碼(error.digest)— server 端丟錯時掛在 Error 上,讓 app/error.tsx 認得出是哪一類。
 *
 * 為什麼不用 error.message 判斷:production build 下,Server Component 丟出的錯誤
 * 傳到 client 時 message 會被 React 換成
 * 「An error occurred in the Server Components render…」,只有 `digest` 原樣保留
 * (Next.js 有自訂 digest 就不會自己再算 hash)。2026-09-03 業主看到的
 * 「發生錯誤 / 2301085382」就是這樣來的:其實只是「請先登入」,但 error.tsx 認不出來。
 *
 * ⚠ 這個檔案會被 client component(error.tsx)import,不能碰 next/headers 或 supabase server client。
 */

export const ERROR_DIGEST = {
  /** 未登入 / 被停用 / 有 auth user 但沒 profile */
  authRequired: "AUTH_REQUIRED",
  /** 登入了但 role 不符 */
  forbidden: "FORBIDDEN",
  /** 有 auth user,但 profiles 查詢本身失敗(連線 / DB 暫時性錯誤)— 重試通常就好 */
  profileLoadFailed: "PROFILE_LOAD_FAILED",
} as const;

export type ErrorDigest = (typeof ERROR_DIGEST)[keyof typeof ERROR_DIGEST];

export type ErrorKind = "permission" | "auth" | "notfound" | "transient" | "generic";

/** React 在 production 遮掉 server 端錯誤訊息時固定的開頭 */
const REACT_REDACTED_PREFIX = "An error occurred in the Server Components render";

/** 把 Error(含 digest)歸類,決定 error.tsx 要顯示哪一種文案與按鈕 */
export function classifyError(
  error: { message?: string | null; digest?: string | null } | null | undefined,
): ErrorKind {
  const digest = error?.digest ?? "";
  if (digest === ERROR_DIGEST.authRequired) return "auth";
  if (digest === ERROR_DIGEST.forbidden) return "permission";
  if (digest === ERROR_DIGEST.profileLoadFailed) return "transient";

  // dev 環境或 client 端丟的錯誤,message 還在 — 沿用舊的字串判斷
  const message = error?.message ?? "";
  if (!message) return "generic";
  if (message.includes("權限不足")) return "permission";
  if (message.includes("請先登入") || message.includes("未登入")) return "auth";
  if (message.includes("找不到") || message.includes("not found")) return "notfound";
  return "generic";
}

/** message 是不是 React 遮掉後的樣板文(這種給使用者看沒有意義) */
export function isRedactedServerMessage(message: string | null | undefined): boolean {
  return (message ?? "").startsWith(REACT_REDACTED_PREFIX);
}
