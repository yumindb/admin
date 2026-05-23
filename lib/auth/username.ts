import { z } from "zod";

/**
 * 帳號實際儲存在 Supabase Auth 的 email 欄,固定後綴 @yumin.local。
 * 使用者只看到/輸入前綴,本檔做雙向轉換。
 *
 * 為什麼用 @yumin.local 而不換成自製 auth — 沿用 Supabase 的密碼雜湊、
 * session、RLS、速率限制,改動最小;將來想換成真 email 也只要拿掉這層轉換。
 */
export const USERNAME_SUFFIX = "@yumin.local";

/** 規則:小寫字母 + 數字,最少 2 字、最多 30 字。 */
export const USERNAME_PATTERN = /^[a-z0-9]{2,30}$/;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "帳號至少 2 個字")
  .max(30, "帳號最多 30 個字")
  .regex(USERNAME_PATTERN, "帳號只能用小寫英文字母與數字");

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}${USERNAME_SUFFIX}`;
}

/**
 * email → 顯示用帳號。若 email 不是 @yumin.local 後綴(例如保留的真 email),
 * 直接回傳整串避免遺失資訊。
 */
export function emailToUsername(email: string | null | undefined): string | null {
  if (!email) return null;
  if (email.endsWith(USERNAME_SUFFIX)) {
    return email.slice(0, -USERNAME_SUFFIX.length);
  }
  return email;
}
