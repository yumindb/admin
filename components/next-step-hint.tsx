import { cn } from "@/lib/utils";

/**
 * 下一步提示元件 — 在表單底部、空狀態下方、頁面 banner 等位置使用,
 * 用來告訴使用者「接下來會發生什麼」或「該做什麼」。
 *
 * 設計原則:不擋畫面、不搶 CTA 焦點。
 * - tone "info":淺米白 + 銅金細左 border(預設)
 * - tone "success":淺綠
 * - tone "warning":淺琥珀
 * - tone "muted":灰色,純說明
 *
 * 用法:
 *   <NextStepHint>建立後可直接上傳標單,工項才能用來填日誌</NextStepHint>
 *   <NextStepHint tone="warning" title="尚未送出">草稿不會通知老闆</NextStepHint>
 */
export function NextStepHint({
  children,
  title,
  icon,
  tone = "info",
  className,
}: {
  children: React.ReactNode;
  title?: string;
  icon?: React.ReactNode;
  tone?: "info" | "success" | "warning" | "muted";
  className?: string;
}) {
  const toneCls = {
    info: "border-[#E0DCD6] bg-[#FAF7F2] text-foreground border-l-4 border-l-[#A07850]",
    success: "border-[#A7F3D0] bg-[#ECFDF5] text-[#4A7C59] border-l-4 border-l-[#4A7C59]",
    warning: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E] border-l-4 border-l-[#D97706]",
    muted: "border-[#E0DCD6] bg-white text-muted-foreground",
  }[tone];

  const iconDefault = {
    info: "→",
    success: "✓",
    warning: "!",
    muted: "·",
  }[tone];

  return (
    <div
      role="note"
      className={cn(
        "rounded-md border px-4 py-3 text-sm",
        toneCls,
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="inline-flex size-5 shrink-0 items-center justify-center text-base font-semibold opacity-80"
        >
          {icon ?? iconDefault}
        </span>
        <div className="min-w-0 flex-1">
          {title && (
            <div className="mb-0.5 font-semibold">{title}</div>
          )}
          <div className="text-sm leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  );
}
