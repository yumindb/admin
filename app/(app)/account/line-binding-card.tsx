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
}: {
  bound: boolean;
  boundAtText: string | null;
  notificationsEnabled: boolean;
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

  if (bound) {
    return (
      <div className="space-y-4">
        <NextStepHint tone="success" title="已綁定 LINE">
          {boundAtText ? `綁定時間:${boundAtText}。` : ""}
          簽核、請假、回報的通知會傳到你的 LINE。
        </NextStepHint>
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

      <NextStepHint>
        綁定後,待簽核、退回、請假結果等通知會即時傳到 LINE。想停掉隨時可以回這裡解除,或傳「{UNBIND_KEYWORD}」給官方帳號。
      </NextStepHint>
    </div>
  );
}
