"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useBodyScrollLock, useEscToClose } from "@/lib/use-modal-behavior";

/**
 * 照片標註編輯器 — 全螢幕 modal,canvas 上畫紅圈 / 箭頭 / 手繪。
 *
 * 設計原則(工地手機情境):
 *   - 工具就三種:畫筆 / 箭頭 / 圈選。顏色三色。不做文字輸入(手機打字慢,
 *     文字說明照片下方本來就有 caption 欄)。
 *   - 標註永遠從「原始照片」畫起(呼叫端傳 original 的 URL 進來),
 *     儲存產生一張新圖 — 原檔不動,以後網站要用好照片還在。
 *   - 匯出長邊上限 2048px:標註圖是「溝通用」,不需要原檔解析度,
 *     省 storage 也省手機記憶體(原檔最大 8MB,直接開 canvas 會爆低階機)。
 *
 * CORS:Supabase storage 回應帶 Access-Control-Allow-Origin: *,
 * img.crossOrigin="anonymous" 後 canvas 不會 tainted,可以 toBlob。
 */

type Tool = "pen" | "arrow" | "ellipse";

type Shape = {
  tool: Tool;
  color: string;
  /** pen:整條軌跡;arrow / ellipse:[起點, 終點] */
  points: { x: number; y: number }[];
};

const COLORS = [
  { value: "#DC2626", label: "紅" },
  { value: "#FACC15", label: "黃" },
  { value: "#2563EB", label: "藍" },
] as const;

const TOOLS: { value: Tool; label: string }[] = [
  { value: "pen", label: "畫筆" },
  { value: "arrow", label: "箭頭" },
  { value: "ellipse", label: "圈選" },
];

const MAX_EDGE = 2048;

export function PhotoAnnotator({
  src,
  onSave,
  onCancel,
  saving,
}: {
  /** 原始照片的 URL(signed)— 每次標註都從乾淨的原圖開始 */
  src: string;
  /** 儲存:拿到標註後的 JPEG blob,由呼叫端上傳並更新資料 */
  onSave: (blob: Blob) => void;
  onCancel: () => void;
  /** 呼叫端上傳中 — 鎖住儲存鍵避免連點 */
  saving?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(COLORS[0].value);
  const [shapes, setShapes] = useState<Shape[]>([]);
  // 進行中的一筆(pointer 還沒放開)— 放 ref 避免 move 過程重 render
  const draftRef = useRef<Shape | null>(null);
  const drawingRef = useRef(false);

  // 全螢幕 modal 慣例:鎖背景捲動 + Esc 關閉(儲存中不能關,避免半途丟工作)
  useBodyScrollLock(true);
  useEscToClose(true, onCancel, !saving);

  // ---- 載圖:縮到上限尺寸,畫進 canvas ----
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      imageRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      setLoadState("ready");
    };
    img.onerror = () => {
      if (!cancelled) setLoadState("error");
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  // ---- 重繪:底圖 + 已完成 shapes + 進行中的 draft ----
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const lineWidth = Math.max(4, Math.round(canvas.width / 240));
    for (const s of [...shapes, draftRef.current].filter(
      (x): x is Shape => x !== null,
    )) {
      drawShape(ctx, s, lineWidth);
    }
  }, [shapes]);

  useEffect(() => {
    if (loadState === "ready") redraw();
  }, [loadState, redraw]);

  // ---- pointer 事件(滑鼠 / 手指 / 觸控筆都吃) ----
  function canvasPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handleDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (loadState !== "ready") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const p = canvasPoint(e);
    draftRef.current = {
      tool,
      color,
      points: tool === "pen" ? [p] : [p, p],
    };
    redraw();
  }

  function handleMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !draftRef.current) return;
    const p = canvasPoint(e);
    if (draftRef.current.tool === "pen") {
      draftRef.current.points.push(p);
    } else {
      draftRef.current.points[1] = p;
    }
    redraw();
  }

  function handleUp() {
    if (!drawingRef.current || !draftRef.current) return;
    drawingRef.current = false;
    const finished = draftRef.current;
    draftRef.current = null;
    // 誤觸(幾乎沒移動)不留下形狀
    const [a, b] = [finished.points[0], finished.points[finished.points.length - 1]];
    const moved = Math.hypot(b.x - a.x, b.y - a.y);
    if (finished.tool !== "pen" && moved < 8) {
      redraw();
      return;
    }
    setShapes((prev) => [...prev, finished]);
  }

  function handleSave() {
    const canvas = canvasRef.current;
    if (!canvas || shapes.length === 0) return;
    draftRef.current = null;
    redraw();
    try {
      canvas.toBlob(
        (blob) => {
          if (blob) onSave(blob);
          else toast.error("產生標註圖失敗，請再試一次");
        },
        "image/jpeg",
        0.85,
      );
    } catch {
      toast.error("瀏覽器不支援此照片的標註，請改用其他照片");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label="照片標註"
    >
      {/* 頂欄:取消 / 說明 / 儲存 */}
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-white/85 hover:bg-white/10"
        >
          取消
        </button>
        <span className="text-xs text-white/60">
          原始照片會保留，標註另存一張
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={shapes.length === 0 || saving}
          className="inline-flex min-h-11 items-center rounded-md bg-[#A07850] px-4 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? "儲存中…" : "儲存標註"}
        </button>
      </div>

      {/* 畫布 */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
        {loadState === "error" ? (
          <p className="px-6 text-center text-sm text-white/80">
            照片載入失敗，可能是連線問題或預覽已過期。關掉重開表單再試一次。
          </p>
        ) : (
          <canvas
            ref={canvasRef}
            onPointerDown={handleDown}
            onPointerMove={handleMove}
            onPointerUp={handleUp}
            onPointerCancel={handleUp}
            className="max-h-full max-w-full rounded-sm"
            style={{ touchAction: "none", cursor: "crosshair" }}
          />
        )}
        {loadState === "loading" && (
          <p className="absolute text-sm text-white/70">照片載入中…</p>
        )}
      </div>

      {/* 底欄:工具 / 顏色 / 復原 */}
      <div className="flex flex-wrap items-center justify-center gap-2 px-3 pb-4 pt-2">
        <div className="flex items-center gap-1 rounded-md bg-white/10 p-1">
          {TOOLS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTool(t.value)}
              aria-pressed={tool === t.value}
              className={`inline-flex min-h-11 items-center rounded px-3 text-sm transition-colors ${
                tool === t.value
                  ? "bg-white text-[#003153]"
                  : "text-white/85 hover:bg-white/10"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-md bg-white/10 p-1">
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setColor(c.value)}
              aria-pressed={color === c.value}
              aria-label={c.label}
              className={`inline-flex size-11 items-center justify-center rounded ${
                color === c.value ? "bg-white/25" : "hover:bg-white/10"
              }`}
            >
              <span
                className="size-6 rounded-full border-2 border-white/70"
                style={{ backgroundColor: c.value }}
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShapes((prev) => prev.slice(0, -1))}
          disabled={shapes.length === 0}
          className="inline-flex min-h-11 items-center rounded-md bg-white/10 px-3 text-sm text-white/85 hover:bg-white/20 disabled:opacity-40"
        >
          復原
        </button>
        <button
          type="button"
          onClick={() => setShapes([])}
          disabled={shapes.length === 0}
          className="inline-flex min-h-11 items-center rounded-md bg-white/10 px-3 text-sm text-white/85 hover:bg-white/20 disabled:opacity-40"
        >
          清除
        </button>
      </div>
    </div>
  );
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  s: Shape,
  lineWidth: number,
) {
  ctx.strokeStyle = s.color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (s.tool === "pen") {
    if (s.points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    return;
  }

  const [a, b] = [s.points[0], s.points[s.points.length - 1]];

  if (s.tool === "arrow") {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // 箭頭頭部:與線身等比例
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const head = lineWidth * 4;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(
      b.x - head * Math.cos(angle - Math.PI / 6),
      b.y - head * Math.sin(angle - Math.PI / 6),
    );
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(
      b.x - head * Math.cos(angle + Math.PI / 6),
      b.y - head * Math.sin(angle + Math.PI / 6),
    );
    ctx.stroke();
    return;
  }

  // ellipse:以拖曳矩形為外框
  ctx.beginPath();
  ctx.ellipse(
    (a.x + b.x) / 2,
    (a.y + b.y) / 2,
    Math.abs(b.x - a.x) / 2,
    Math.abs(b.y - a.y) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.stroke();
}
