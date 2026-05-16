/**
 * 地理計算工具 — Haversine 距離、Google Maps 連結解析、座標格式化。
 *
 * 純函式、無 IO、無 SSR 邊界,可在 client / server / Edge 共用。
 */

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_000;

/**
 * 兩點球面距離(公尺),Haversine。
 * 工地尺度(< 10 km)誤差遠小於 GPS 本身精度,夠用。
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 從 Google Maps URL 抽出座標。支援以下常見格式:
 *  - https://www.google.com/maps/@25.0330,121.5654,17z
 *  - https://www.google.com/maps/place/.../@25.0330,121.5654,17z
 *  - https://maps.google.com/?q=25.0330,121.5654
 *  - https://maps.google.com/maps?ll=25.0330,121.5654
 *  - https://www.google.com/maps?q=loc:25.0330,121.5654
 *  - https://goo.gl/maps/xxx → 短網址,需先展開 → return null,提示使用者貼長網址
 *  - 純座標字串 "25.0330, 121.5654" / "25.0330,121.5654"
 *
 * 找不到回 null。
 */
export function parseGoogleMapsUrl(input: string): LatLng | null {
  const text = input.trim();
  if (!text) return null;

  // Case 1: 純座標 "lat,lng" or "lat, lng"
  const coordOnly = text.match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (coordOnly) {
    const lat = Number(coordOnly[1]);
    const lng = Number(coordOnly[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  // Case 2: URL @lat,lng,zoom (place / search / 純座標 URL 都會有)
  const atMatch = text.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)(?:,\d+(?:\.\d+)?z?)?/);
  if (atMatch) {
    const lat = Number(atMatch[1]);
    const lng = Number(atMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  // Case 3: ?q=lat,lng or ?q=loc:lat,lng
  const qMatch = text.match(/[?&]q=(?:loc:)?(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (qMatch) {
    const lat = Number(qMatch[1]);
    const lng = Number(qMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  // Case 4: ?ll=lat,lng
  const llMatch = text.match(/[?&]ll=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (llMatch) {
    const lat = Number(llMatch[1]);
    const lng = Number(llMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  return null;
}

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0) // 海上 0,0 幾乎一定是錯,不接受
  );
}

/**
 * 顯示用:6 位小數(約 11 公分精度,與 DB numeric(9,6) 對齊)。
 */
export function formatLatLng(p: LatLng): string {
  return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
}

/**
 * 距離 → 人類可讀字串(公尺 / 公里)。
 *  - < 1000 m:整數公尺
 *  - >= 1000 m:1 位小數公里
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * 給定 case 座標 + 半徑 + 打卡點,回傳距離 + 是否在範圍內。
 * case 座標未設(null)時 distance = null, withinGeofence = null。
 */
export function evaluateGeofence(
  caseLoc: { lat: number | null; lng: number | null; geofence_radius_m: number },
  point: LatLng,
): { distanceM: number | null; withinGeofence: boolean | null } {
  if (caseLoc.lat === null || caseLoc.lng === null) {
    return { distanceM: null, withinGeofence: null };
  }
  const d = haversineMeters({ lat: caseLoc.lat, lng: caseLoc.lng }, point);
  return { distanceM: d, withinGeofence: d <= caseLoc.geofence_radius_m };
}

/**
 * 開啟外部 Google Maps 的連結(office 點查打卡點用)。
 * 永遠用 zero-cost 的 google.com/maps?q= 形式,不打 API。
 */
export function googleMapsLink(p: LatLng): string {
  return `https://www.google.com/maps?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}
