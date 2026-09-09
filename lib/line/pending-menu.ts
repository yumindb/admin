import { createServiceClient } from "@/lib/supabase/server";
import { isLineConfigured } from "./client";
import {
  OWNER_ALIAS,
  OWNER_PENDING_ALIAS,
  linkRichMenuByAlias,
} from "./richmenu";

/**
 * 老闆 Rich Menu 的「還有未核定」狀態同步(2026-08 Phil 要求)。
 *
 * LINE 的 Rich Menu 是一張固定圖片,沒有動態徽章或數字 — 唯一能在選單上
 * 反映狀態的方式,是事先做好兩張圖(有待核定 / 沒有),再依狀態換掉那個人
 * 身上掛的選單。切換走 richmenu API,**不計訊息額度**。
 *
 * 只做「有 / 沒有」兩態,不顯示份數(業主 2026-08 決定):份數要 11 張圖、
 * 漏一個觸發點數字就不準,而不準的數字比沒數字更糟。
 *
 * 單簽制(2026-09 起):有任何一份停在核定關就是「有待核定」,所有核定人同一個狀態。
 * owner 只有幾位,所以每次事件都全體重算,不做增量 — 沒有漂移,也不用管誰受影響。
 *
 * 刻意**不看 `notifications_enabled`**:那是「暫停推播」的開關,而選單是
 * 使用者自己點開才看到的被動狀態,不會吵人。
 *
 * 絕不 throw — 選單同步失敗不能影響簽核主流程。
 */
export async function syncOwnerApprovalMenus(): Promise<void> {
  if (!isLineConfigured()) return;
  try {
    const supabase = createServiceClient();

    const { data: owners } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "owner");
    const ownerIds = (owners ?? []).map((o) => o.id as string);
    if (ownerIds.length === 0) return;

    const { data: bindings } = await supabase
      .from("line_bindings")
      .select("profile_id, line_user_id")
      .in("profile_id", ownerIds)
      .not("line_user_id", "is", null);
    if (!bindings || bindings.length === 0) return;

    const { count } = await supabase
      .from("daily_logs")
      .select("id", { count: "exact", head: true })
      .eq("status", "submitted")
      .eq("current_stage", "approve");
    const hasPending = (count ?? 0) > 0;

    for (const b of bindings) {
      const lineUserId = b.line_user_id as string;
      await linkRichMenuByAlias(
        lineUserId,
        hasPending ? OWNER_PENDING_ALIAS : OWNER_ALIAS,
      );
    }
  } catch (e) {
    console.error("[richmenu] 待核定選單同步失敗:", e);
  }
}
