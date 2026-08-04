"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";

/**
 * 站內消息的已讀動作。
 *
 * 寫入走 user client + RLS(app_messages_update_own,migration-2.33)—
 * 使用者本來就只動得到自己那幾 row,不需要 service-role。
 * 保險起見 server 端仍然自己再 `.eq("profile_id", actor.id)` 一次。
 */

export async function markMessageReadAction(messageId: string) {
  const actor = await tryGetActor();
  if (!actor) return { ok: false as const, error: "未登入" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("profile_id", actor.id)
    .is("read_at", null);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/messages");
  return { ok: true as const };
}

export async function markAllMessagesReadAction() {
  const actor = await tryGetActor();
  if (!actor) return { ok: false as const, error: "未登入" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", actor.id)
    .is("read_at", null);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/messages");
  return { ok: true as const };
}
