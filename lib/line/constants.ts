/**
 * LINE 官方帳號公開常數 — 不含任何 secret,client component 可安全 import。
 * (channel secret / access token 只存在 env,只在 lib/line/client.ts 讀取)
 */

/** 裕民工務 LINE 官方帳號 ID(顯示用) */
export const LINE_OA_ID = "@449ibxsb";

/** 加好友連結(手機點了直接開 LINE) */
export const LINE_OA_ADD_FRIEND_URL = `https://line.me/R/ti/p/${LINE_OA_ID}`;

/** 綁定碼有效時間(分鐘) */
export const BINDING_CODE_TTL_MINUTES = 30;

/** 解除綁定關鍵字(傳給官方帳號的訊息) */
export const UNBIND_KEYWORD = "解除綁定";
