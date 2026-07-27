import { describe, it, expect } from "vitest";
import { imageSizeFromDataUrl } from "../pdf/image-size";

function pngDataUrl(width: number, height: number): string {
  // 只需要 parser 會讀的部分:PNG magic(8) + IHDR length/type(8) + w/h(8)
  const buf = Buffer.alloc(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buf.writeUInt32BE(13, 8); // IHDR length
  buf.write("IHDR", 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function jpegDataUrl(width: number, height: number): string {
  // SOI + APP0(長度 4 的空段)+ SOF0 段頭
  const buf = Buffer.alloc(2 + 4 + 9);
  let o = 0;
  buf[o++] = 0xff; buf[o++] = 0xd8;             // SOI
  buf[o++] = 0xff; buf[o++] = 0xe0;             // APP0
  buf.writeUInt16BE(2, o); o += 2;              // 段長(只含自己)
  buf[o++] = 0xff; buf[o++] = 0xc0;             // SOF0
  buf.writeUInt16BE(7, o); o += 2;              // 段長
  buf[o++] = 8;                                  // precision
  buf.writeUInt16BE(height, o); o += 2;
  buf.writeUInt16BE(width, o); o += 2;
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

describe("imageSizeFromDataUrl", () => {
  it("reads PNG dimensions", () => {
    expect(imageSizeFromDataUrl(pngDataUrl(1200, 400))).toEqual({
      width: 1200,
      height: 400,
    });
  });

  it("reads JPEG dimensions from SOF0", () => {
    expect(imageSizeFromDataUrl(jpegDataUrl(800, 600))).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("sniffs bytes, not the declared mime", () => {
    // mime 寫 jpeg、內容是 PNG — 早期資料 mime 有混用,要以 bytes 為準
    const url = pngDataUrl(300, 100).replace("image/png", "image/jpeg");
    expect(imageSizeFromDataUrl(url)).toEqual({ width: 300, height: 100 });
  });

  it("returns null for garbage input", () => {
    expect(imageSizeFromDataUrl("data:image/png;base64,aGVsbG8=")).toBeNull();
    expect(imageSizeFromDataUrl("not-a-data-url")).toBeNull();
    expect(imageSizeFromDataUrl("data:image/png;base64,")).toBeNull();
  });
});
