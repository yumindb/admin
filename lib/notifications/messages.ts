import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import type { AppMessage, AppMessageEvent, UserRole } from "@/lib/types";

/**
 * 站內消息(app_messages,migration-2.33)。
 *
 * 為什麼有這一層 — LINE 通知不夠用:
 *   2026-08-04 業主回報「日誌我核過的,我有在下面給意見,可是底下的人那裡
 *   不會跳通知出來」。查下去是設計問題不是 bug:sendNotification() 只送給
 *   **已綁定 LINE** 的人,而主任 / 助理都沒綁(問過也沒有想綁的意思,
 *   助理習慣用電腦)。意見寫了就只躺在日誌頁最底下的簽核歷程裡。
 *
 * 這裡是另一條獨立通道:
 *   - 不需要綁定任何東西,登入就看得到(header 鈴鐺 → /messages)
 *   - 不吃官方帳號的 200 則/月額度,所以可以放心逐份發
 *   - 跟 LINE 並存:綁了 LINE 的人兩邊都收得到,沒綁的至少 App 裡有
 *
 * 投遞規則(2026-08-04 業主拍板:「有意見,再有消息就好」):
 *   通過**且有寫意見** / 退回 / 強制退回 / 撤回核定 → 發;
 *   通過但沒寫意見 → 不發(不然每天一堆「已核定」把真正要看的洗掉)。
 *
 * 設計約束(同 notify.ts):
 *   - 一律 service-role(在 after() 裡跑,user session 可能已失效;
 *     app_messages 也刻意沒有 INSERT policy,使用者不能偽造消息)
 *   - 絕不 throw — 消息發不出去不能影響簽核主流程
 *   - migration-2.33 還沒跑時靜靜跳過(表不存在),功能其餘部分照常
 */

/** 同一份日誌 + 同事件 + 同收件人,這段時間內只發一則(重複點、批簽重跑用) */
const DEDUPE_WINDOW_MS = 60 * 1000;

/** 消息內文裡的意見引用長度上限 — 完整內容點進去看簽核歷程 */
const BODY_MAX = 300;

export type CreateMessagesInput = {
  eventType: AppMessageEvent;
  /** 收件人 profile ids(會自動去重、排除 actor) */
  profileIds: string[];
  /** 額外收件角色 — 該角色所有啟用中的人(例:重送要通知全部辦公室助理) */
  roles?: UserRole[];
  title: string;
  body?: string | null;
  /** 點開要去哪;日誌類一律深連到簽核歷程那一段 */
  link?: string | null;
  relatedId?: string | null;
  /** 留言者(不會收到自己的消息) */
  actorId?: string | null;
};

/** 表不存在(migration 還沒跑)— PostgREST 回 PGRST205,pg 回 42P01 */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    (err.message ?? "").includes("app_messages")
  );
}

export function truncateBody(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;
  return t.length > BODY_MAX ? t.slice(0, BODY_MAX) + "…" : t;
}

/**
 * 發站內消息給一群人。永不 throw。
 */
export async function createAppMessages(
  input: CreateMessagesInput,
): Promise<void> {
  try {
    const actorId = input.actorId ?? null;
    const supabase = createServiceClient();

    const ids = new Set(input.profileIds.filter(Boolean));
    if (input.roles && input.roles.length > 0) {
      const { data: roleRows, error: roleErr } = await supabase
        .from("profiles")
        .select("id")
        .in("role", input.roles)
        .eq("is_active", true);
      if (roleErr) {
        console.error("[messages] 讀角色收件人失敗:", roleErr.message);
      } else {
        for (const p of roleRows ?? []) ids.add(p.id as string);
      }
    }
    const targets = Array.from(ids).filter((id) => id !== actorId);
    if (targets.length === 0) return;

    // 停用的帳號不發(離職的人收件匣不用長)
    const { data: activeRows, error: profErr } = await supabase
      .from("profiles")
      .select("id")
      .in("id", targets)
      .eq("is_active", true);
    if (profErr) {
      console.error("[messages] 讀收件人 profiles 失敗:", profErr.message);
      return;
    }
    const active = (activeRows ?? []).map((p) => p.id as string);
    if (active.length === 0) return;

    // 去重:同 related + event + 收件人,一分鐘內已發過就跳過
    // (重複點送出、批簽重跑都會走到這裡)
    let recipients = active;
    if (input.relatedId) {
      const cutoff = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
      const { data: recent, error: dupErr } = await supabase
        .from("app_messages")
        .select("profile_id")
        .eq("event_type", input.eventType)
        .eq("related_id", input.relatedId)
        .in("profile_id", active)
        .gt("created_at", cutoff);
      if (dupErr) {
        if (isMissingTable(dupErr)) return; // migration 還沒跑
        console.error("[messages] 去重查詢失敗:", dupErr.message);
      } else {
        const sent = new Set((recent ?? []).map((r) => r.profile_id as string));
        recipients = active.filter((id) => !sent.has(id));
      }
    }
    if (recipients.length === 0) return;

    const { error: insErr } = await supabase.from("app_messages").insert(
      recipients.map((profileId) => ({
        profile_id: profileId,
        event_type: input.eventType,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        related_id: input.relatedId ?? null,
        actor_id: actorId,
      })),
    );
    if (insErr && !isMissingTable(insErr)) {
      console.error("[messages] 寫入失敗:", insErr.message);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[messages] createAppMessages threw:", msg);
  }
}

/**
 * 未讀數(header 鈴鐺)。查不到 / 表還沒建 → 0,不讓 layout 掛掉。
 */
export async function countUnreadMessages(
  supabase: SupabaseClient,
  profileId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("app_messages")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .is("read_at", null);
  if (error) {
    if (!isMissingTable(error)) {
      console.error("[messages] 未讀數查詢失敗:", error.message);
    }
    return 0;
  }
  return count ?? 0;
}

/**
 * 收件匣(預設近 50 則)。表還沒建 → 空陣列。
 */
export async function listMessages(
  supabase: SupabaseClient,
  profileId: string,
  limit = 50,
): Promise<AppMessage[]> {
  const { data, error } = await supabase
    .from("app_messages")
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (!isMissingTable(error)) {
      console.error("[messages] 收件匣查詢失敗:", error.message);
    }
    return [];
  }
  return (data ?? []) as AppMessage[];
}

/**
 * 日誌詳情頁用:這份日誌有沒有「我還沒讀」的意見消息 —
 * 有的話頁面上把簽核歷程那段標出來,順便標成已讀(人已經看到了)。
 */
export async function findUnreadForRelated(
  supabase: SupabaseClient,
  profileId: string,
  relatedId: string,
): Promise<AppMessage[]> {
  const { data, error } = await supabase
    .from("app_messages")
    .select("*")
    .eq("profile_id", profileId)
    .eq("related_id", relatedId)
    .is("read_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    if (!isMissingTable(error)) {
      console.error("[messages] 未讀查詢失敗:", error.message);
    }
    return [];
  }
  return (data ?? []) as AppMessage[];
}
