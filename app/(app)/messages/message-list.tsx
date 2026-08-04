"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatTW } from "@/lib/datetime";
import {
  markAllMessagesReadAction,
  markMessageReadAction,
} from "./actions";
import type { AppMessage } from "@/lib/types";

/**
 * 消息中心清單。
 *
 * 互動只有一種:點一則 → 標成已讀 → 跳到那份日誌的簽核歷程。
 * (意見的正本永遠在 log_approvals,消息只是把人帶過去的信封。)
 *
 * 樂觀更新:點下去先把這則變灰,不等 server 回來 —
 * 助理一次清十幾則時不該每則都等一趟 round trip。
 */
export function MessageList({ messages }: { messages: AppMessage[] }) {
  const router = useRouter();
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [allRead, setAllRead] = useState(false);
  const [isPending, startTransition] = useTransition();

  const isUnread = (m: AppMessage) =>
    !m.read_at && !allRead && !readIds.has(m.id);
  const unreadCount = messages.filter(isUnread).length;

  function open(m: AppMessage) {
    if (isUnread(m)) {
      setReadIds((prev) => new Set(prev).add(m.id));
      void markMessageReadAction(m.id);
    }
    if (m.link) router.push(m.link);
  }

  function markAll() {
    setAllRead(true);
    startTransition(async () => {
      const res = await markAllMessagesReadAction();
      if (!res.ok) {
        setAllRead(false);
        toast.error("標記失敗：" + res.error);
        return;
      }
      toast.success("都標成已讀了");
      router.refresh();
    });
  }

  return (
    <div>
      {unreadCount > 0 && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={markAll}
            disabled={isPending}
            className="inline-flex min-h-11 items-center rounded-md border border-[#E0DCD6] bg-white px-4 text-sm text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            全部標成已讀（{unreadCount}）
          </button>
        </div>
      )}

      <ul className="space-y-2.5">
        {messages.map((m) => {
          const unread = isUnread(m);
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => open(m)}
                className={`w-full rounded-md border px-4 py-3.5 text-left transition-colors ${
                  unread
                    ? "border-[#E0DCD6] border-l-4 border-l-[#A07850] bg-[#FAF7F2] hover:bg-[#F5F1EC]"
                    : "border-[#E0DCD6] bg-white hover:bg-[#FAF7F2]"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {unread && (
                    <span
                      aria-label="未讀"
                      className="inline-flex items-center rounded-full bg-[#B91C1C] px-2 py-0.5 text-xs font-semibold text-white"
                    >
                      未讀
                    </span>
                  )}
                  <span
                    className={`text-base ${
                      unread
                        ? "font-semibold text-primary"
                        : "font-medium text-foreground"
                    }`}
                  >
                    {m.title}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatTW(m.created_at)}
                  </span>
                </div>
                {m.body && (
                  <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    {m.body}
                  </p>
                )}
                {m.link && (
                  <p className="mt-2 text-xs text-accent">點開看這份日誌 →</p>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
