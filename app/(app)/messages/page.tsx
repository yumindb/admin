import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox, FileSignature } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import { listMessages } from "@/lib/notifications/messages";
import {
  listPendingSignables,
  type PendingSignables,
} from "@/lib/approvals/pending-signables";
import { LEAVE_TYPE_LABEL } from "@/lib/leave";
import { formatDateTW, formatTW } from "@/lib/datetime";
import { NextStepHint } from "@/components/next-step-hint";
import { MessageList } from "./message-list";
import type { ApprovalStage, UserRole } from "@/lib/types";

/**
 * 消息中心(2026-08-04)。
 *
 * 業主回報:「日誌我核過的,我有在下面給意見,可是底下的人那裡不會跳通知出來。」
 * 通知本來只走 LINE,而底下的人沒綁 LINE — 這頁就是不需要綁定的那條通道。
 *
 * 只放「要人看到才有用」的事:簽核意見、退回原因、撤回核定。
 * 一般的「已核定」不進來(業主拍板:有意見,再有消息就好)。
 *
 * 2026-08-06 加「等你簽核」區塊:業主要消息頁也看得到該我簽的文件,
 * 簽完就消失。這塊是即時查狀態(lib/approvals/pending-signables.ts),
 * 不是 app_messages 的一種 — 所以沒有已讀/未讀,簽掉自然就不見。
 */

const STAGE_ACTION_LABEL: Record<ApprovalStage, string> = {
  fill: "填表",
  review: "複核",
  audit: "審核",
  approve: "核定",
};

export default async function MessagesPage() {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");

  const supabase = await createClient();
  // 消息與待簽清單互不相干 — 平行查,不排隊
  const [messages, pending] = await Promise.all([
    listMessages(supabase, actor.id),
    listPendingSignables(supabase, {
      id: actor.id,
      role: actor.role as UserRole,
    }),
  ]);
  const pendingCount = pending.logs.length + pending.leaves.length;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-primary md:text-3xl">消息</h1>
        <p className="mt-1.5 text-base text-muted-foreground">
          等你簽核的文件、簽核意見、退回原因都會出現在這裡。點一則就跳過去。
        </p>
      </div>

      {pendingCount > 0 && <PendingSection pending={pending} />}

      {messages.length === 0 ? (
        pendingCount > 0 ? (
          // 有待簽但沒消息:小小說一句就好,別讓大空狀態把待簽區塊擠下去
          <p className="rounded-md border border-dashed border-[#E0DCD6] bg-card px-4 py-5 text-center text-sm text-muted-foreground">
            沒有新消息 —— 簽核的人留意見或退回時才會出現在這裡
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-20 text-center">
              <Inbox
                className="mb-3 size-14 text-[#E0DCD6]"
                strokeWidth={1.5}
                aria-hidden
              />
              <p className="text-base text-foreground">
                目前沒有消息，也沒有等你簽的文件
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                有日誌或請假等你簽核、或簽核的人留意見/退回時，這裡會跳紅點
              </p>
            </div>
            <NextStepHint tone="muted">
              通過而且沒留意見的日誌不會發消息 —— 這裡只出現真的要你看的事。
            </NextStepHint>
          </div>
        )
      ) : (
        <MessageList messages={messages} />
      )}
    </div>
  );
}

/**
 * 「等你簽核」— 即時狀態,不是消息:沒有未讀標記,簽完下次進來就不在了。
 * 卡片統一走琥珀色(同 /approvals 的「等另一位補簽」提示),跟下面
 * 米白/棕的消息卡一眼分得開:黃的要動手,白的用看的。
 */
function PendingSection({ pending }: { pending: PendingSignables }) {
  const actionLabel = pending.stage
    ? STAGE_ACTION_LABEL[pending.stage]
    : "簽核";
  const count = pending.logs.length + pending.leaves.length;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <FileSignature className="size-5 text-[#A07850]" aria-hidden />
        <h2 className="text-lg font-semibold text-primary">等你簽核</h2>
        <span
          aria-label={`待簽 ${count} 件`}
          className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-[#B91C1C] px-2 py-0.5 text-sm font-semibold tabular-nums text-white"
        >
          {count}
        </span>
      </div>

      <ul className="space-y-2.5">
        {pending.logs.map((log) => (
          <li key={log.id}>
            <Link
              href={`/approvals/${log.id}`}
              className="block rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3.5 transition-colors hover:border-accent active:bg-[#FEF3C7]"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-base font-semibold text-primary">
                  {formatDateTW(log.log_date)} 施工日誌
                </span>
                <span className="text-sm text-muted-foreground">
                  {log.caseName ?? "—"}
                  {log.caseCode ? `（${log.caseCode}）` : ""}
                  {log.supervisorName ? ` · ${log.supervisorName}` : ""}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-[#92400E]">
                等你{actionLabel} —— 點開處理，簽好這則就會消失 →
              </p>
            </Link>
          </li>
        ))}
        {pending.leaves.map((r) => (
          <li key={r.id}>
            <Link
              href={`/leaves/${r.id}`}
              className="block rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3.5 transition-colors hover:border-accent active:bg-[#FEF3C7]"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-base font-semibold text-primary">
                  {r.applicantName ?? "—"} 的{LEAVE_TYPE_LABEL[r.leave_type]}
                </span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {formatTW(r.start_at, {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {" — "}
                  {formatTW(r.end_at, {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {` · ${r.total_hours} 小時`}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-[#92400E]">
                等你簽核 —— 點開處理，簽好這則就會消失 →
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
