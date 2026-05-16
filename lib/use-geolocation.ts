"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type GeoFix = {
  lat: number;
  lng: number;
  accuracy_m: number;
  timestamp: number;
};

export type GeoState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ok"; fix: GeoFix }
  | { status: "error"; code: GeoErrorCode; message: string };

export type GeoErrorCode =
  | "unsupported"      // 瀏覽器沒 Geolocation API(罕見)
  | "permission_denied" // user 拒絕授權
  | "unavailable"      // 系統無法取得位置(GPS 關閉、wifi 太弱)
  | "timeout"          // 超時
  | "insecure";        // 非 https 不會給(localhost 例外)

const DEFAULT_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,  // 要求 GPS 而非 IP / wifi-only
  maximumAge: 30_000,        // 30s 內的舊讀數可接受(省電 + 加速)
  timeout: 15_000,           // 15s 沒回 → 視為 timeout
};

/**
 * React hook 包 navigator.geolocation.getCurrentPosition。
 * autoFetch=true 時 mount 後立即取一次位置(打卡頁適用)。
 * 也可呼叫 refresh() 手動重取。
 */
export function useGeolocation(opts: { autoFetch?: boolean } = {}): GeoState & {
  refresh: () => void;
} {
  const [state, setState] = useState<GeoState>({ status: "idle" });
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    if (typeof window === "undefined") return;

    if (!("geolocation" in navigator)) {
      setState({
        status: "error",
        code: "unsupported",
        message: "此瀏覽器不支援定位功能。",
      });
      return;
    }

    // https / localhost 才會給位置。非 secure context 直接報錯,免得使用者等半天。
    if (window.isSecureContext === false) {
      setState({
        status: "error",
        code: "insecure",
        message: "需在 HTTPS 環境下使用(本機開發例外)。",
      });
      return;
    }

    setState({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!isMounted.current) return;
        setState({
          status: "ok",
          fix: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy,
            timestamp: pos.timestamp,
          },
        });
      },
      (err) => {
        if (!isMounted.current) return;
        const code: GeoErrorCode =
          err.code === err.PERMISSION_DENIED
            ? "permission_denied"
            : err.code === err.POSITION_UNAVAILABLE
              ? "unavailable"
              : "timeout";
        const message =
          code === "permission_denied"
            ? "請允許瀏覽器使用定位權限。手機端可在「網站設定」開啟。"
            : code === "unavailable"
              ? "無法取得位置。請確認 GPS / 定位服務已開啟,並到戶外/窗邊再試一次。"
              : "定位超時。請重新點「重新定位」。";
        setState({ status: "error", code, message });
      },
      DEFAULT_OPTIONS,
    );
  }, []);

  // Auto-fetch on mount
  const autoFetch = opts.autoFetch ?? false;
  useEffect(() => {
    if (autoFetch) refresh();
  }, [autoFetch, refresh]);

  return { ...state, refresh };
}

/** 精度文字標籤,給 UI 顯示綠/黃/紅 */
export function accuracyLevel(accuracy_m: number): "good" | "fair" | "poor" {
  if (accuracy_m <= 50) return "good";
  if (accuracy_m <= 200) return "fair";
  return "poor";
}

/**
 * 「靜默」一次性取位置 — 給 /logs/new、/field-reports/new 隱式 GPS 戳記用。
 * 政策(配 D5):僅在使用者「先前已授權」時才靜默取位置;若 permission 是 prompt
 * 或 denied,*不* 觸發詢問彈窗、不報錯、回 null。
 *
 * 使用者第一次到 /attendance 才會被詢問;之後其他頁面就免擾。
 *
 * 回傳當前 fix(可能為 null = 沒授權 / 取不到 / SSR);不會 throw。
 */
export function useSilentLocationOnce(): GeoFix | null {
  const [fix, setFix] = useState<GeoFix | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("geolocation" in navigator)) return;
    if (window.isSecureContext === false) return;

    let cancelled = false;

    (async () => {
      // 先檢查 permission,prompt/denied 都不主動觸發
      try {
        if ("permissions" in navigator) {
          const perm = await navigator.permissions.query({
            name: "geolocation" as PermissionName,
          });
          if (perm.state !== "granted") return;
        }
        // 沒 Permissions API 的舊瀏覽器:仍嘗試取(會走 prompt) — Safari 部分版本如此
      } catch {
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          setFix({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy,
            timestamp: pos.timestamp,
          });
        },
        () => {
          /* silent fail */
        },
        { enableHighAccuracy: true, maximumAge: 60_000, timeout: 8_000 },
      );
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return fix;
}
