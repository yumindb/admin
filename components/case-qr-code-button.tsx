"use client";

import { useState } from "react";
import { ModalShell } from "@/components/ui/modal-shell";
import { QRCodeSVG } from "qrcode.react";
import { X, QrCode } from "lucide-react";

export function CaseQrCodeButton({
  caseId,
  caseName,
}: {
  caseId: string;
  caseName: string;
}) {
  const [open, setOpen] = useState(false);

  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/field-reports/new?case=${caseId}`
      : `/field-reports/new?case=${caseId}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex size-16 flex-col items-center justify-center gap-1 rounded-lg border border-[#E0DCD6] bg-card text-primary transition-colors hover:border-accent hover:text-accent active:bg-[#F5F1EC]"
        aria-label="顯示 QR Code"
      >
        <QrCode className="size-6 shrink-0" aria-hidden />
        <span className="text-[11px] font-medium leading-none tracking-wide">QR Code</span>
      </button>

      {open && (
        <ModalShell
          onClose={() => setOpen(false)}
          ariaLabel="現場回報 QR Code"
          overlayClassName="bg-black/60"
          panelClassName="relative max-w-[320px] bg-white p-6"
        >
          {/* Close */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F1EC] hover:text-primary"
            aria-label="關閉"
          >
            <X className="size-5" />
          </button>

          {/* Header */}
          <h2 className="pr-8 text-base font-semibold text-primary">
            現場回報 QR Code
          </h2>
          <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
            {caseName}
          </p>

          {/* QR Code */}
          <div className="mt-5 flex justify-center">
            <div className="rounded-md border-2 border-[#E0DCD6] p-3">
              <QRCodeSVG
                value={url}
                size={220}
                fgColor="#003153"
                bgColor="#FFFFFF"
                level="M"
              />
            </div>
          </div>

          {/* Hint */}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            現場工人掃碼，直接填此案場回報
          </p>
        </ModalShell>
      )}
    </>
  );
}
