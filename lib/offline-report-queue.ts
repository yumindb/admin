/**
 * 離線現場回報排隊(對應 attendance 的 offline-clock-queue.ts)
 *
 * 設計與 clock queue 同邏輯:純前景 IndexedDB,不做 Service Worker。
 * 唯一差別:photos[] 只存「已上傳到 Supabase Storage 的 path」,
 * 不存 File blob — 因為上傳已成功的照片在 Storage 端持久,
 * 重送出 report 只是把這些 paths 寫進 DB。
 *
 * 如果 user 在「照片上傳途中」就斷網,那些照片不會進 queue;
 * 等使用者回到表單後可以重新加照片(可選自動還原草稿)。
 */

import type { FieldReportPhoto } from "@/lib/types";

const DB_NAME = "yumin-offline-field-reports";
const DB_VERSION = 1;
const STORE = "pending_reports";

export type PendingReport = {
  id: string;                  // 本機 uuid
  case_id: string;
  note: string;
  photos: FieldReportPhoto[];  // 已上傳到 Storage 的 path + caption
  submit_lat: number | null;
  submit_lng: number | null;
  submit_accuracy_m: number | null;
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

export async function enqueueReport(
  payload: Omit<
    PendingReport,
    "id" | "client_created_at" | "attempts" | "last_error"
  >,
): Promise<PendingReport> {
  const row: PendingReport = {
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

export async function listPendingReports(): Promise<PendingReport[]> {
  return tx("readonly", (store) => {
    return new Promise<PendingReport[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const arr = (req.result as PendingReport[]) ?? [];
        arr.sort((a, b) => a.client_created_at.localeCompare(b.client_created_at));
        resolve(arr);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function removeReport(id: string): Promise<void> {
  await tx("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

export async function bumpReportAttempts(id: string, errMsg: string): Promise<void> {
  await tx("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const row = getReq.result as PendingReport | undefined;
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

export const MAX_REPORT_ATTEMPTS = 5;
