import { describe, it, expect } from "vitest";
import { extractStoragePath, normalizePhotoPaths } from "../supabase/storage";

const SIGNED =
  "https://giclppjyuguylbqvjozx.supabase.co/storage/v1/object/sign/daily-photos/uid-1/1785242484443-lhj1fb.jpg?token=eyJhbGciOi.abc-def_123";
const PUBLIC =
  "https://giclppjyuguylbqvjozx.supabase.co/storage/v1/object/public/daily-photos/uid-1/old.jpg";
const PATH = "uid-1/1785242484443-lhj1fb.jpg";

describe("extractStoragePath", () => {
  it("signed URL → 去掉網域與 token", () => {
    expect(extractStoragePath(SIGNED, "daily-photos")).toBe(PATH);
  });

  it("public URL(POC 時期的舊資料)→ path", () => {
    expect(extractStoragePath(PUBLIC, "daily-photos")).toBe("uid-1/old.jpg");
  });

  it("已經是 path → 原樣(冪等)", () => {
    expect(extractStoragePath(PATH, "daily-photos")).toBe(PATH);
  });
});

describe("normalizePhotoPaths", () => {
  it("path 與 original_path 都收斂,caption 不動", () => {
    const out = normalizePhotoPaths(
      [{ path: SIGNED, caption: "三樓拆除", original_path: PUBLIC }],
      "daily-photos",
    );
    expect(out).toEqual([
      { path: PATH, caption: "三樓拆除", original_path: "uid-1/old.jpg" },
    ]);
  });

  it("沒有 original_path 的照片不會被塞一個 undefined 進去", () => {
    const out = normalizePhotoPaths([{ path: SIGNED, caption: "" }], "daily-photos");
    expect(Object.keys(out[0])).toEqual(["path", "caption"]);
  });

  it("重跑不會再變(冪等)— 存過一次的 path 再存一次還是一樣", () => {
    const once = normalizePhotoPaths([{ path: SIGNED, caption: "" }], "daily-photos");
    expect(normalizePhotoPaths(once, "daily-photos")).toEqual(once);
  });

  it("null / undefined → 空陣列", () => {
    expect(normalizePhotoPaths(null, "daily-photos")).toEqual([]);
    expect(normalizePhotoPaths(undefined, "daily-photos")).toEqual([]);
  });
});
