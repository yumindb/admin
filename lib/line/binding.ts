import { randomInt } from "node:crypto";

/**
 * 綁定碼工具 — 純函式,方便測試。
 * 6 位數字(不足補零),對講電話 / 抄在紙上都好唸。
 * 碰撞由 DB unique constraint 擋,呼叫端重試。
 */

export function generateBindingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** 使用者傳進來的文字是否長得像綁定碼(容忍前後空白) */
export function looksLikeBindingCode(text: string): boolean {
  return /^\d{6}$/.test(text.trim());
}
