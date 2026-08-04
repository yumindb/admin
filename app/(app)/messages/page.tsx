import { redirect } from "next/navigation";
import { Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import { listMessages } from "@/lib/notifications/messages";
import { NextStepHint } from "@/components/next-step-hint";
import { MessageList } from "./message-list";

/**
 * 消息中心(2026-08-04)。
 *
 * 業主回報:「日誌我核過的,我有在下面給意見,可是底下的人那裡不會跳通知出來。」
 * 通知本來只走 LINE,而底下的人沒綁 LINE — 這頁就是不需要綁定的那條通道。
 *
 * 只放「要人看到才有用」的事:簽核意見、退回原因、撤回核定。
 * 一般的「已核定」不進來(業主拍板:有意見,再有消息就好)。
 */
export default async function MessagesPage() {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");

  const supabase = await createClient();
  const messages = await listMessages(supabase, actor.id);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-primary md:text-3xl">消息</h1>
        <p className="mt-1.5 text-base text-muted-foreground">
          簽核意見、退回原因都會出現在這裡。點一則就跳到那份日誌。
        </p>
      </div>

      {messages.length === 0 ? (
        <div className="space-y-4">
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-20 text-center">
            <Inbox
              className="mb-3 size-14 text-[#E0DCD6]"
              strokeWidth={1.5}
              aria-hidden
            />
            <p className="text-base text-foreground">目前沒有消息</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              簽核的人在日誌上留意見或退回時，這裡會跳紅點
            </p>
          </div>
          <NextStepHint tone="muted">
            通過而且沒留意見的日誌不會發消息 —— 這裡只出現真的要你看的事。
          </NextStepHint>
        </div>
      ) : (
        <MessageList messages={messages} />
      )}
    </div>
  );
}
