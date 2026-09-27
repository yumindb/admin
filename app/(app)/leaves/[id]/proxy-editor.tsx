"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateLeaveProxyAction } from "../actions";

/**
 * 更換 / 取消代理人(migration-2.43)。申請的主任本人、辦公室助理、老闆看得到。
 * 存檔後新代理人收到「被指定」、原代理人收到「代理取消」(站內消息 + LINE)。
 */
export function ProxyEditor({
  requestId,
  currentProxyId,
  candidates,
}: {
  requestId: string;
  currentProxyId: string | null;
  candidates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentProxyId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const dirty = value !== (currentProxyId ?? "");

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateLeaveProxyAction({
        requestId,
        proxyId: value || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(value ? "代理人已更新，也通知對方了" : "已取消代理人");
      router.refresh();
    });
  }

  return (
    <div>
      <label
        htmlFor="leave-proxy-edit"
        className="mb-2 block text-sm font-medium text-foreground"
      >
        {currentProxyId ? "更換代理人" : "指定代理人"}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          id="leave-proxy-edit"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="block h-12 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 sm:flex-1"
        >
          <option value="">不指定</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || isPending}
          className="inline-flex h-12 shrink-0 items-center justify-center rounded-md bg-primary px-5 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "儲存中…" : "儲存"}
        </button>
      </div>
      {error && (
        <p className="mt-2 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          {error}
        </p>
      )}
    </div>
  );
}
