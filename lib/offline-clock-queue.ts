/**
 * 離線打卡排隊(Phase 2.24)— 前景 IndexedDB queue。
 *
 * 設計取捨:
 *  - 不做 Service Worker / BackgroundSync,因為:
 *     1. iOS Safari 不支援 BackgroundSync(工地主任多 iPhone)
 *     2. Next.js 16 + next-pwa 相容性風險
 *     3. 實際情境「打卡 → 走出工地 → 再開 app」前景 flush 已涵蓋
 *  - 純前景:每次 /attendance mount + window 'online' event 時嘗試 flush
 *  - 重試上限 5 次,失敗保留在 queue 等下次手動處理
 *  - 跨頁不掉資料:IndexedDB 持久化即使 tab 關閉也在
 *
 * 不存 user_id — server action 寫入時用 auth.uid()。
 * server-side computed 欄位(distance / within_geofence)由 server 算,client 不存。
 */

const DB_NAME = "yumin-offline-clock";
const DB_VERSION = 1;
const STORE = "pending_clocks";

export type PendingClock = {
  id: string;              // local uuid；不是 server id
  event_type: "clock_in" | "clock_out";
  case_id: string | null;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  note: string | null;
  // 紀錄當時實際時間,而非送出成功時間
  client_created_at: string;
  attempts: number;
  last_error: string | null;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("client_created_at", "client_created_at");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let result: T;
        Promise.resolve(fn(store)).then((r) => {
          result = r;
        }).catch(reject);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function enqueue(
  payload: Omit<PendingClock, "id" | "client_created_at" | "attempts" | "last_error">,
): Promise<PendingClock> {
  const row: PendingClock = {
    ...payload,
    id: genId(),
    client_created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
  };
  await tx("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const req = store.add(row);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
  return row;
}

export async function listPending(): Promise<PendingClock[]> {
  return tx("readonly", (store) => {
    return new Promise<PendingClock[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const arr = (req.result as PendingClock[]) ?? [];
        arr.sort((a, b) => a.client_created_at.localeCompare(b.client_created_at));
        resolve(arr);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function remove(id: string): Promise<void> {
  await tx("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

export async function bumpAttempts(id: string, errMsg: string): Promise<void> {
  await tx("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const row = getReq.result as PendingClock | undefined;
        if (!row) {
          resolve();
          return;
        }
        row.attempts += 1;
        row.last_error = errMsg;
        const putReq = store.put(row);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  });
}

export const MAX_ATTEMPTS = 5;

/** 視為「應該排隊」的失敗類型:網路斷線、fetch fail、navigator.onLine=false。
 *  validation error / 權限不足等 server 端業務錯誤 → 不應重試,直接報給使用者。 */
export function isOfflineErrorMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("network") ||
    lower.includes("failed to fetch") ||
    lower.includes("load failed") ||
    lower.includes("typeerror") ||
    lower.includes("offline")
  );
}
