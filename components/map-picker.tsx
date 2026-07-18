"use client";

/**
 * 純 client-side Leaflet 地圖 picker。
 * 由 case-location-picker 透過 dynamic import (ssr: false) 載入,
 * 確保 leaflet 只在 client bundle、不上 SSR(否則 window not defined)。
 */

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLng } from "@/lib/geo";

// Leaflet default icon 的圖路徑在 webpack/Next 環境會壞掉,
// 改成 inline data URI(深海軍藍針 icon,與品牌一致)。
const PIN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
  <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 24 16 24s16-12 16-24C32 7.16 24.84 0 16 0z" fill="#003153"/>
  <circle cx="16" cy="16" r="6" fill="#A07850"/>
</svg>`;
const PIN_ICON = L.icon({
  iconUrl: `data:image/svg+xml;base64,${typeof btoa !== "undefined" ? btoa(PIN_SVG) : ""}`,
  iconSize: [32, 40],
  iconAnchor: [16, 40],
  popupAnchor: [0, -32],
});

type Props = {
  center: LatLng;
  point: LatLng | null;
  radius: number;
  onPick: (p: LatLng) => void;
};

export default function MapPicker({ center, point, radius, onPick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const onPickRef = useRef(onPick);

  // 把最新 onPick 存到 ref,避免 closure 過時但又不重建地圖
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  // 初始化地圖(僅 mount 時跑一次)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const start = point ?? center;
    const map = L.map(containerRef.current, {
      center: [start.lat, start.lng],
      zoom: point ? 17 : 13,
      zoomControl: true,
      scrollWheelZoom: false, // 避免使用者捲頁時被地圖搶走(桌機滾輪)
      // 手機同理:單指在全寬地圖上滑 = 拖地圖,頁面捲到這裡就卡住出不來。
      // 觸控裝置關掉單指拖曳(捲頁恢復正常),移動地圖靠點選/搜尋地址/雙指縮放。
      dragging: !L.Browser.mobile,
    });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      onPickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // 故意只跑一次:後續 point/center/radius 變化由下面兩個 effect 處理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 處理 marker + circle + pan
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (point) {
      // marker
      if (markerRef.current) {
        markerRef.current.setLatLng([point.lat, point.lng]);
      } else {
        markerRef.current = L.marker([point.lat, point.lng], {
          icon: PIN_ICON,
          draggable: true,
        }).addTo(map);
        markerRef.current.on("dragend", () => {
          const pos = markerRef.current?.getLatLng();
          if (pos) onPickRef.current({ lat: pos.lat, lng: pos.lng });
        });
      }
      // circle(geofence 視覺化)
      if (circleRef.current) {
        circleRef.current.setLatLng([point.lat, point.lng]);
        circleRef.current.setRadius(radius);
      } else {
        circleRef.current = L.circle([point.lat, point.lng], {
          radius,
          color: "#A07850",
          weight: 2,
          fillColor: "#A07850",
          fillOpacity: 0.1,
        }).addTo(map);
      }
      // 平移到新點(zoom 拉到 17 才看得到 geofence)
      if (map.getZoom() < 15) {
        map.setView([point.lat, point.lng], 17);
      } else {
        map.panTo([point.lat, point.lng]);
      }
    } else {
      // 清空 marker / circle
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      if (circleRef.current) {
        circleRef.current.remove();
        circleRef.current = null;
      }
    }
  }, [point, radius]);

  return (
    <div>
      <div
        ref={containerRef}
        className="h-[280px] w-full rounded-md border border-[#E0DCD6] bg-white"
        style={{ zIndex: 0 }}
      />
      {L.Browser.mobile && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          手機上直接點地圖選位置、雙指縮放；要移動地圖請用上方搜尋地址。
        </p>
      )}
    </div>
  );
}
