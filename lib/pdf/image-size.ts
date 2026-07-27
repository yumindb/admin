/**
 * 從 base64 data URL 讀出圖片的原始寬高 — 給 PDF 簽名圖算長寬比用。
 *
 * 為什麼需要:@react-pdf/renderer 的 <Image> 只給 height 時,寬度會拉滿
 * 父容器(不是等比縮放),簽名全部被壓成扁長條(2026-07 裕民印出紙本才發現)。
 * 要等比呈現只能自己算出 width = height × (w/h) 塞給它。
 *
 * 不看 data URL 宣告的 mime,直接嗅探 magic bytes(早期資料 mime 有混用)。
 */

export type ImageSize = { width: number; height: number };

export function imageSizeFromDataUrl(dataUrl: string): ImageSize | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(dataUrl.slice(comma + 1), "base64");
  } catch {
    return null;
  }
  return pngSize(buf) ?? jpegSize(buf);
}

/** PNG:magic 8 bytes + IHDR chunk,width/height 在 offset 16/20(big-endian) */
function pngSize(buf: Buffer): ImageSize | null {
  if (buf.length < 24) return null;
  if (
    buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47
  ) {
    return null;
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** JPEG:走 marker 鏈找 SOF(C0–CF,排除 DHT C4 / JPG C8 / DAC CC) */
function jpegSize(buf: Buffer): ImageSize | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let off = 2;
  // 讀 SOF 的 w/h 需要 off+5..off+8 共 9 bytes 都在範圍內
  while (off + 9 <= buf.length) {
    if (buf[off] !== 0xff) {
      off += 1;
      continue;
    }
    const marker = buf[off + 1];
    if (
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    ) {
      const height = buf.readUInt16BE(off + 5);
      const width = buf.readUInt16BE(off + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    const len = buf.readUInt16BE(off + 2);
    if (len < 2) return null;
    off += 2 + len;
  }
  return null;
}
