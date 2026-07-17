import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import {
  isLineConfigured,
  pushLineMessage,
  type LineMessage,
} from "@/lib/line/client";
import type { UserRole } from "@/lib/types";

/**
 * 推播佇列核心 — 所有通知都經過這裡:
 *
 *   1. 解析收件人(role → 啟用中的 profiles;或指定 profile ids)
 *   2. 只留「已綁定 LINE 且通知開啟」的人
 *   3. 去重:同 profile_id + event_type + related_id 十分鐘內只送一次
 *   4. 寫入 notification_queue(pending)→ 立刻推播 → 更新 sent / failed
 *   5. 失敗的由夜間 cron retryPendingNotifications() 重試(最多 3 次)
 *
 * 設計約束:
 *   - 一律用 service-role client(在 after() 裡跑,user session 可能已失效)
 *   - 絕不 throw — 通知失敗不能影響簽核 / 請假主流程
 *   - LINE env 沒設時,佇列照寫但標 'skipped',方便日後確認漏了哪些
 */

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const RETRY_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 超過 24 小時的通知過時了,不再重送
const QUEUE_RETENTION_DAYS = 30;

export type NotifyRecipients = {
  /** 通知這些角色的所有啟用中使用者 */
  roles?: UserRole[];
  /** 通知特定使用者 */
  profileIds?: string[];
  /** 排除(例:不通知操作者本人) */
  excludeProfileIds?: string[];
};

export type NotifyInput = {
  eventType: string;
  /** 日誌 / 請假 / 回報 id;彙總訊息用 null(去重改看 event_type) */
  relatedId: string | null;
  recipients: NotifyRecipients;
  altText: string;
  message: LineMessage;
};

/**
 * 送出一則通知給一群人。永不 throw。
 */
export async function sendNotification(input: NotifyInput): Promise<void> {
  try {
    const supabase = createServiceClient();

    // 1. 解析收件人
    const targetIds = new Set<string>(input.recipients.profileIds ?? []);
    if (input.recipients.roles && input.recipients.roles.length > 0) {
      const { data: roleProfiles, error } = await supabase
        .from("profiles")
        .select("id")
        .in("role", input.recipients.roles)
        .eq("is_active", true);
      if (error) {
        console.error("[notifications] 讀 profiles 失敗:", error.message);
        return;
      }
      for (const p of roleProfiles ?? []) targetIds.add(p.id as string);
    }
    for (const ex of input.recipients.excludeProfileIds ?? []) {
      targetIds.delete(ex);
    }
    if (targetIds.size === 0) return;

    // 2. 只留已綁定 + 通知開啟的
    const { data: bindings, error: bindErr } = await supabase
      .from("line_bindings")
      .select("profile_id, line_user_id")
      .in("profile_id", Array.from(targetIds))
      .eq("notifications_enabled", true)
      .not("line_user_id", "is", null);
    if (bindErr) {
      console.error("[notifications] 讀 line_bindings 失敗:", bindErr.message);
      return;
    }
    if (!bindings || bindings.length === 0) return;

    // 3. 去重(十分鐘內同 profile + event + related 已送過就跳過)
    const cutoff = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
    let dedupeQuery = supabase
      .from("notification_queue")
      .select("profile_id")
      .eq("event_type", input.eventType)
      .in("status", ["pending", "sent"])
      .gt("created_at", cutoff)
      .in(
        "profile_id",
        bindings.map((b) => b.profile_id as string),
      );
    dedupeQuery =
      input.relatedId === null
        ? dedupeQuery.is("related_id", null)
        : dedupeQuery.eq("related_id", input.relatedId);
    const { data: recent } = await dedupeQuery;
    const alreadyNotified = new Set(
      (recent ?? []).map((r) => r.profile_id as string),
    );

    const targets = bindings.filter(
      (b) => !alreadyNotified.has(b.profile_id as string),
    );
    if (targets.length === 0) return;

    // 4. enqueue
    const configured = isLineConfigured();
    const { data: rows, error: insErr } = await supabase
      .from("notification_queue")
      .insert(
        targets.map((b) => ({
          profile_id: b.profile_id,
          event_type: input.eventType,
          related_id: input.relatedId,
          alt_text: input.altText,
          message: input.message,
          status: configured ? "pending" : "skipped",
          error: configured ? null : "LINE 金鑰未設定,通知未送出",
        })),
      )
      .select("id, profile_id");
    if (insErr) {
      console.error("[notifications] 寫佇列失敗:", insErr.message);
      return;
    }
    if (!configured) return;

    // 5. 立刻送(使用者數少,循序送就好)
    const lineIdByProfile = new Map(
      targets.map((b) => [b.profile_id as string, b.line_user_id as string]),
    );
    for (const row of rows ?? []) {
      const to = lineIdByProfile.get(row.profile_id as string);
      if (!to) continue;
      const res = await pushLineMessage(to, [input.message]);
      await supabase
        .from("notification_queue")
        .update(
          res.ok
            ? { status: "sent", sent_at: new Date().toISOString(), attempts: 1 }
            : { status: "failed", error: res.error, attempts: 1 },
        )
        .eq("id", row.id);
      if (!res.ok) {
        console.error(
          `[notifications] 推播失敗 (queue ${row.id}):`,
          res.error,
        );
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notifications] sendNotification threw:", msg);
  }
}

/**
 * cron 用:重試沒送成的(pending / failed,24 小時內,attempts < 3),
 * 並清掉超過 30 天的舊佇列紀錄。
 */
export async function retryPendingNotifications(
  supabase: SupabaseClient,
): Promise<{ retried: number; sent: number; purged: number; error: string | null }> {
  const result = { retried: 0, sent: 0, purged: 0, error: null as string | null };
  try {
    // 清舊資料(先清,失敗不影響重試)
    const purgeCutoff = new Date(
      Date.now() - QUEUE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { count: purged } = await supabase
      .from("notification_queue")
      .delete({ count: "exact" })
      .lt("created_at", purgeCutoff);
    result.purged = purged ?? 0;

    if (!isLineConfigured()) return result;

    const ageCutoff = new Date(Date.now() - RETRY_MAX_AGE_MS).toISOString();
    const { data: stale, error: selErr } = await supabase
      .from("notification_queue")
      .select("id, profile_id, message, attempts")
      .in("status", ["pending", "failed"])
      .lt("attempts", MAX_ATTEMPTS)
      .gt("created_at", ageCutoff)
      .limit(50);
    if (selErr) {
      result.error = selErr.message;
      return result;
    }
    if (!stale || stale.length === 0) return result;

    // 重新查綁定(可能已解綁 → skipped)
    const profileIds = Array.from(
      new Set(stale.map((r) => r.profile_id as string)),
    );
    const { data: bindings } = await supabase
      .from("line_bindings")
      .select("profile_id, line_user_id")
      .in("profile_id", profileIds)
      .eq("notifications_enabled", true)
      .not("line_user_id", "is", null);
    const lineIdByProfile = new Map(
      (bindings ?? []).map((b) => [
        b.profile_id as string,
        b.line_user_id as string,
      ]),
    );

    for (const row of stale) {
      result.retried += 1;
      const to = lineIdByProfile.get(row.profile_id as string);
      if (!to) {
        await supabase
          .from("notification_queue")
          .update({ status: "skipped", error: "使用者已解綁或關閉通知" })
          .eq("id", row.id);
        continue;
      }
      const res = await pushLineMessage(to, [row.message as LineMessage]);
      await supabase
        .from("notification_queue")
        .update(
          res.ok
            ? {
                status: "sent",
                sent_at: new Date().toISOString(),
                attempts: (row.attempts as number) + 1,
              }
            : {
                status: "failed",
                error: res.error,
                attempts: (row.attempts as number) + 1,
              },
        )
        .eq("id", row.id);
      if (res.ok) result.sent += 1;
    }
    return result;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    return result;
  }
}
