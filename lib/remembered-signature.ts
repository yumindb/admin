/**
 * 60 分鐘內共用的簽名 cache (localStorage)。
 *
 * 工地主任視角:戴手套在工地簽名痛苦,每天可能 5+ 次簽 (日誌送出 + 退回後修 + 複核)。
 * 老闆視角:批簽已有,但單份簽核也想記住。
 *
 * 用法:簽完之後 writeRemembered(dataUrl) → 下次任何簽名場景 readRemembered()
 * 拿到 dataUrl 後 sigRef.fromDataURL() 還原 + 顯示「已使用上次簽名」hint。
 *
 * Key v1 跟 batch-actions 共用 — 不分 stage / form。
 */

const KEY = "yumin-approval-sig-v1";
const TTL_MS = 60 * 60 * 1000;

type Stored = { dataUrl: string; savedAt: number };

export function readRememberedSig(): Stored | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as Stored;
    if (!obj?.dataUrl || !obj?.savedAt) return null;
    if (Date.now() - obj.savedAt > TTL_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return obj;
  } catch {
    return null;
  }
}

export function writeRememberedSig(dataUrl: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ dataUrl, savedAt: Date.now() } satisfies Stored),
    );
  } catch {
    // quota exceeded — silently ignore
  }
}

export function clearRememberedSig(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
