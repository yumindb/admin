import type { NextConfig } from "next";

/**
 * 全站安全標頭(2026-09-26 資安健檢):
 * - X-Frame-Options:不讓別的網站把簽核頁嵌進 iframe 騙人點(clickjacking)
 * - X-Content-Type-Options:瀏覽器不要猜檔案類型
 * - Referrer-Policy:連到外站時只帶網域,不帶完整網址(網址裡可能有案件 / 日誌 id)
 * - Permissions-Policy:只有本站能用定位(打卡)與相機,其他功能一律關
 * - X-Robots-Tag:內部系統,不要被搜尋引擎收錄
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "geolocation=(self), camera=(self), microphone=(), payment=(), usb=()",
  },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // 簽名 PNG dataURL + 多張照片 base64 併送會踩 Next 預設 1MB 上限。
      // 4MB 給簽核 + 6 張壓過的照片留充裕空間。
      bodySizeLimit: "4mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
