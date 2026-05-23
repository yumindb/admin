import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Textarea 設計系統元件 — 與 Input 同款邊框 / focus / placeholder 顏色,
 * 字級用 text-base 跟 Input 對齊(原本許多地方 raw <textarea> 寫 text-sm,
 * 視覺上比 Input 小一號,UI 審查抓到此不一致)。
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-base text-foreground placeholder:text-[#8A847C] outline-none transition-colors",
        "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
