import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * LINE Messaging API 底層 wrapper — server-side only。
 *
 * 鐵則:
 *   - LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN 只在這裡讀,不傳前端
 *   - env 沒設時所有函式安全 no-op(回 error 結果,不 throw)—
 *     讓程式可以先上線,Evelyn 之後補 env 即生效
 *   - push 失敗不 throw,回 { ok:false, error } 讓佇列記錄後由 cron 重試
 */

const LINE_API_BASE = "https://api.line.me/v2/bot";

export type LineMessage = Record<string, unknown>;

export type LineSendResult = { ok: true } | { ok: false; error: string };

/** channel secret + access token 都設了才算配置完成 */
export function isLineConfigured(): boolean {
  return Boolean(
    process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN,
  );
}

/**
 * 驗證 webhook 的 X-Line-Signature。
 * signature = base64(HMAC-SHA256(channel secret, request raw body))
 * secret 沒設 → 一律 false(webhook 端直接忽略事件)。
 */
export function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  secret: string | undefined = process.env.LINE_CHANNEL_SECRET,
): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

async function callLineApi(
  path: string,
  body: Record<string, unknown>,
): Promise<LineSendResult> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN 未設定" };

  try {
    const res = await fetch(`${LINE_API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => "");
    return { ok: false, error: `LINE API ${res.status}: ${text.slice(0, 300)}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `LINE API 連線失敗: ${msg}` };
  }
}

/**
 * 推播訊息給單一使用者(計入官方帳號每月訊息額度)。
 * to = LINE userId(line_bindings.line_user_id)
 */
export async function pushLineMessage(
  to: string,
  messages: LineMessage[],
): Promise<LineSendResult> {
  return callLineApi("/message/push", { to, messages });
}

/**
 * 回覆 webhook 事件(免費,不計額度;replyToken 約 1 分鐘內有效、只能用一次)。
 */
export async function replyLineMessage(
  replyToken: string,
  messages: LineMessage[],
): Promise<LineSendResult> {
  return callLineApi("/message/reply", { replyToken, messages });
}
