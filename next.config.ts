import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // 簽名 PNG dataURL + 多張照片 base64 併送會踩 Next 預設 1MB 上限。
      // 4MB 給簽核 + 6 張壓過的照片留充裕空間。
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
