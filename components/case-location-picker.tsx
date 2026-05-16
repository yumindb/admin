"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatLatLng,
  googleMapsLink,
  parseGoogleMapsUrl,
  type LatLng,
} from "@/lib/geo";

const MapPicker = dynamic(() => import("./map-picker"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[280px] items-center justify-center rounded-md border border-dashed border-[#E0DCD6] bg-[#FBF8F4] text-sm text-muted-foreground">
      載入地圖中…
    </div>
  ),
});

type Props = {
  /** form field names — server action 從 formData 抓 */
  latFieldName?: string;
  lngFieldName?: string;
  radiusFieldName?: string;
  defaultLat?: number | null;
  defaultLng?: number | null;
  defaultRadius?: number;
};

const DEFAULT_RADIUS = 200;

// 台中市中心 — 沒有預設座標時的地圖起始點(裕民主場域)
const TAICHUNG_CENTER: LatLng = { lat: 24.1477, lng: 120.6736 };

export function CaseLocationPicker({
  latFieldName = "lat",
  lngFieldName = "lng",
  radiusFieldName = "geofence_radius_m",
  defaultLat = null,
  defaultLng = null,
  defaultRadius = DEFAULT_RADIUS,
}: Props) {
  const initial: LatLng | null =
    defaultLat !== null && defaultLng !== null
      ? { lat: defaultLat, lng: defaultLng }
      : null;

  const [point, setPoint] = useState<LatLng | null>(initial);
  const [radius, setRadius] = useState<number>(defaultRadius);
  const [urlInput, setUrlInput] = useState<string>("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlOk, setUrlOk] = useState<boolean>(false);
  const urlOkTimer = useRef<NodeJS.Timeout | null>(null);

  // url paste → 立即解析(不需按按鈕)
  useEffect(() => {
    if (!urlInput.trim()) {
      setUrlError(null);
      setUrlOk(false);
      return;
    }
    const parsed = parseGoogleMapsUrl(urlInput);
    if (parsed) {
      setPoint(parsed);
      setUrlError(null);
      setUrlOk(true);
      if (urlOkTimer.current) clearTimeout(urlOkTimer.current);
      urlOkTimer.current = setTimeout(() => setUrlOk(false), 2500);
    } else {
      setUrlError("無法解析此連結。請貼 Google Maps 完整網址(含 @ 座標)或直接貼 25.0337,121.5645 這種格式。");
      setUrlOk(false);
    }
  }, [urlInput]);

  useEffect(() => {
    return () => {
      if (urlOkTimer.current) clearTimeout(urlOkTimer.current);
    };
  }, []);

  const handleMapClick = useCallback((p: LatLng) => {
    setPoint(p);
  }, []);

  const clear = useCallback(() => {
    setPoint(null);
    setUrlInput("");
    setUrlError(null);
    setUrlOk(false);
  }, []);

  const radiusPresets = [100, 200, 500, 1000];

  return (
    <div className="space-y-3 rounded-md border border-[#E0DCD6] bg-[#FBF8F4] p-4">
      <div className="flex items-baseline justify-between">
        <label className="text-sm font-medium text-primary">
          工地座標（GPS 打卡用，選填）
        </label>
        {point && (
          <button
            type="button"
            onClick={clear}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-accent hover:underline"
          >
            清除座標
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        貼上 Google Maps 連結會自動解析，或直接在地圖上點選位置。打卡時系統會算「離工地多遠」，超過半徑會被標註但仍可送出。
      </p>

      {/* Google Maps URL 輸入 */}
      <div className="space-y-1">
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="貼上 Google Maps 連結，或直接輸入 25.0337,121.5645"
          className="flex h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-sm text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
        {urlError && (
          <p className="text-xs text-[#B91C1C]">{urlError}</p>
        )}
        {urlOk && (
          <p className="text-xs text-[#4A7C59]">✓ 已解析座標，地圖已定位</p>
        )}
      </div>

      {/* 地圖點選 */}
      <MapPicker
        center={point ?? TAICHUNG_CENTER}
        point={point}
        radius={radius}
        onPick={handleMapClick}
      />

      {/* 半徑 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-foreground">
            打卡範圍半徑
          </label>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {radius} m
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {radiusPresets.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRadius(r)}
              className={`rounded-md border px-2.5 py-1 text-xs transition ${
                radius === r
                  ? "border-accent bg-accent text-white"
                  : "border-[#E0DCD6] bg-white text-foreground hover:border-accent/50"
              }`}
            >
              {r} m
            </button>
          ))}
          <input
            type="number"
            min={10}
            max={5000}
            step={10}
            value={radius}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setRadius(Math.max(10, Math.min(5000, Math.round(v))));
            }}
            className="ml-auto h-8 w-24 rounded-md border border-[#E0DCD6] bg-white px-2 text-xs tabular-nums outline-none focus-visible:border-accent"
            aria-label="自訂半徑（公尺）"
          />
        </div>
      </div>

      {/* 顯示已選座標 */}
      {point && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-xs">
          <span className="text-muted-foreground">已選座標</span>
          <span className="font-mono tabular-nums text-foreground">
            {formatLatLng(point)}
          </span>
          <a
            href={googleMapsLink(point)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-accent underline-offset-2 hover:underline"
          >
            在 Google Maps 開啟 ↗
          </a>
        </div>
      )}

      {/* hidden inputs — submit 時帶到 form */}
      <input
        type="hidden"
        name={latFieldName}
        value={point ? point.lat.toFixed(6) : ""}
      />
      <input
        type="hidden"
        name={lngFieldName}
        value={point ? point.lng.toFixed(6) : ""}
      />
      <input type="hidden" name={radiusFieldName} value={String(radius)} />
    </div>
  );
}
