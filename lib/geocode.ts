/**
 * 地址 → 座標(正向 geocoding)— 用 OpenStreetMap Nominatim。
 *
 * 為什麼選 Nominatim:
 *   - 免費(無 API key、無計費)
 *   - Taiwan 覆蓋率對「縣市路名」夠用(街道精度可能差幾十米,但 geofence 200 m 內可接受)
 *
 * 限速:1 req/sec(Nominatim usage policy)— client-side debounce + 顯示「處理中」即可
 * 必要 header:User-Agent 須識別應用程式(Nominatim 強制)
 *
 * 限制:
 *   - 鄉鎮巷弄精度有時不準,使用者仍可在地圖手動微調
 *   - 找不到就 return []
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "yumin-admin/1.0 (https://github.com/yumindb/admin)";

export type GeocodeResult = {
  lat: number;
  lng: number;
  display_name: string;        // 完整地址（Nominatim 回的格式化字串）
  importance: number;          // Nominatim 給的「相關度」，0-1
};

async function rawGeocode(
  q: string,
  limit: number,
  restrictTaiwan: boolean,
): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({
    q,
    format: "json",
    addressdetails: "0",
    limit: String(limit),
  });
  if (restrictTaiwan) params.set("countrycodes", "tw");

  const resp = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "Accept-Language": "zh-TW,zh",
    },
  });
  if (!resp.ok) throw new Error(`geocode 失敗： HTTP ${resp.status}`);
  const body = (await resp.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
    importance?: number;
  }>;
  return body
    .map((r) => ({
      lat: Number(r.lat),
      lng: Number(r.lon),
      display_name: r.display_name,
      importance: typeof r.importance === "number" ? r.importance : 0,
    }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
    .sort((a, b) => b.importance - a.importance);
}

/** 簡化台灣地址 — Nominatim 對精確門牌號覆蓋差,去掉巷弄號數段可大幅提升命中率 */
function simplifyTaiwanAddress(address: string): string | null {
  // 去掉結尾的「XX號」「XX號 N 樓」「XX巷 N號」
  const trimmed = address
    .replace(/\s*\d+\s*樓.*$/u, "")
    .replace(/\s*\d+\s*號.*$/u, "")
    .trim();
  if (trimmed && trimmed !== address) return trimmed;
  // 再試:去掉「巷 / 弄」段
  const noLane = address.replace(/\s*\d+\s*(巷|弄).*$/u, "").trim();
  if (noLane && noLane !== address) return noLane;
  return null;
}

/**
 * 查地址。回傳最多 5 個候選結果,依 importance 倒序。
 * 預設限定台灣(countrycodes=tw),避免「中山路」誤撈香港 / 大陸。
 *
 * 找不到 → 自動 fallback:去掉「XX號」/「XX巷」精確段再試一次,
 * Nominatim 對台灣街道(非門牌)覆蓋好很多。
 */
export async function geocodeAddress(
  address: string,
  opts: { limit?: number; restrictTaiwan?: boolean } = {},
): Promise<GeocodeResult[]> {
  const q = address.trim();
  if (!q) return [];

  const limit = opts.limit ?? 5;
  const restrictTaiwan = opts.restrictTaiwan !== false;

  const first = await rawGeocode(q, limit, restrictTaiwan);
  if (first.length > 0) return first;

  // Fallback:簡化地址(去號 / 去巷)
  const simplified = simplifyTaiwanAddress(q);
  if (!simplified) return [];

  // 限速 1 req/sec — 與第一次至少間隔 1.1s
  await new Promise((r) => setTimeout(r, 1100));
  return rawGeocode(simplified, limit, restrictTaiwan);
}
