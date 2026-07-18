"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { NextStepHint } from "@/components/next-step-hint";
import {
  LINE_OA_ADD_FRIEND_URL,
  LINE_OA_ID,
  UNBIND_KEYWORD,
} from "@/lib/line/constants";
import {
  generateLineBindingCodeAction,
  setLineNotificationsAction,
  unbindLineAction,
} from "./actions";

/**
 * /account 的 LINE 通知綁定卡。
 * 未綁定:三步驟引導(加好友 → 產生綁定碼 → 傳碼給官方帳號)。
 * 已綁定:顯示狀態 + 暫停通知 + 解除綁定。
 */
export function LineBindingCard({
  bound,
  boundAtText,
  notificationsEnabled,
  receiveLabels,
}: {
  bound: boolean;
  boundAtText: string | null;
  notificationsEnabled: boolean;
  /** 這個人目前會收到的通知分類(由 /staff 管理端設定;空 = 全關) */
  receiveLabels: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState<string | null>(null);
  const [ttl, setTtl] = useState<number>(30);
  const [confirmUnbind, setConfirmUnbind] = useState(false);

  const generateCode = () => {
    startTransition(async () => {
      const res = await generateLineBindingCodeAction();
      if (res.ok) {
        setCode(res.code);
        setTtl(res.ttlMinutes);
      } else {
        toast.error(res.error);
      }
    });
  };

  const toggleNotifications = () => {
    startTransition(async () => {
      const res = await setLineNotificationsAction(!notificationsEnabled);
      if (res.ok) {
        toast.success(
          notificationsEnabled ? "已暫停 LINE 通知" : "已恢復 LINE 通知",
        );
      } else {
        toast.error(res.error);
      }
    });
  };

  const unbind = () => {
    startTransition(async () => {
      const res = await unbindLineAction();
      setConfirmUnbind(false);
      if (res.ok) {
        setCode(null);
        toast.success("已解除 LINE 綁定");
      } else {
        toast.error(res.error);
      }
    });
  };

  const receiveSummary =
    receiveLabels.length > 0 ? (
      <div className="rounded-md border border-[#E0DCD6] bg-white px-4 py-3">
        <div className="mb-1.5 text-xs text-muted-foreground">
          {bound ? "你會收到的通知" : "綁定後你會收到的通知"}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {receiveLabels.map((label) => (
            <span
              key={label}
              className="rounded-full border border-[#E0DCD6] bg-[#FAF7F2] px-2.5 py-0.5 text-xs text-foreground"
            >
              {label}
            </span>
          ))}
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground">
          要調整項目請找辦公室助理或老闆（人員管理 → 通知）。
        </div>
      </div>
    ) : (
      <NextStepHint tone="warning">
        目前沒有開啟任何通知項目，{bound ? "" : "就算完成綁定"}
        也不會收到通知。請找辦公室助理或老闆在「人員管理 → 通知」幫你開啟。
      </NextStepHint>
    );

  if (bound) {
    return (
      <div className="space-y-4">
        <NextStepHint tone="success" title="已綁定 LINE">
          {boundAtText ? `綁定時間:${boundAtText}。` : ""}
          開啟的通知項目會傳到你的 LINE。
        </NextStepHint>
        {receiveSummary}
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={toggleNotifications}
            disabled={pending}
            variant="outline"
            className="h-11 border-[#E0DCD6]"
          >
            {notificationsEnabled ? "暫停通知" : "恢復通知"}
          </Button>
          <Button
            type="button"
            onClick={() => setConfirmUnbind(true)}
            disabled={pending}
            variant="outline"
            className="h-11 border-[#FCA5A5] text-[#B91C1C] hover:bg-[#FEF2F2]"
          >
            解除綁定
          </Button>
        </div>
        {!notificationsEnabled && (
          <NextStepHint tone="warning">
            通知目前是暫停狀態,不會收到任何 LINE 訊息。
          </NextStepHint>
        )}
        <ConfirmDialog
          open={confirmUnbind}
          title="解除 LINE 綁定?"
          description="解除後不會再收到系統通知。之後想再收,重新產生綁定碼綁回來就可以。"
          confirmText="解除綁定"
          danger
          pending={pending}
          onConfirm={unbind}
          onCancel={() => setConfirmUnbind(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground">
        <li>
          用 LINE 加官方帳號{" "}
          <span className="font-semibold">{LINE_OA_ID}</span> 好友(手機點下面按鈕直接開)
        </li>
        <li>回這頁點「產生綁定碼」</li>
        <li>把 6 位數字傳給官方帳號,收到「綁定成功」就完成了</li>
      </ol>

      <div className="flex flex-wrap gap-3">
        <a
          href={LINE_OA_ADD_FRIEND_URL}
          target="_blank"
          rel="noopener"
          className="inline-flex h-11 items-center rounded-md border border-[#E0DCD6] bg-card px-4 text-sm font-medium text-foreground hover:bg-[#FAF7F2]"
        >
          加 LINE 好友
        </a>
        <Button
          type="button"
          onClick={generateCode}
          disabled={pending}
          className="h-11 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {pending ? "產生中…" : code ? "重新產生綁定碼" : "產生綁定碼"}
        </Button>
      </div>

      {code && (
        <div className="rounded-md border border-[#E0DCD6] bg-[#FAF7F2] p-4 text-center">
          <div className="mb-1 text-xs text-muted-foreground">
            你的綁定碼({ttl} 分鐘內有效)
          </div>
          <div className="select-all font-mono text-3xl font-bold tracking-[0.3em] text-primary">
            {code}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            把這 6 位數字傳給官方帳號就完成綁定
          </div>
        </div>
      )}

      {receiveSummary}

      <NextStepHint>
        綁定後,開啟的通知項目會即時傳到 LINE。想停掉隨時可以回這裡解除,或傳「{UNBIND_KEYWORD}」給官方帳號。
      </NextStepHint>
    </div>
  );
}
