"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import {
  DISMISS_DAYS,
  DISMISSIBLE_ALERT_KINDS,
  type DismissibleAlertKind,
} from "@/lib/dashboard-dismiss";

/**
 * 儀表板「需要您出手」警示的暫時忽略(migration-2.30)。
 *
 * 刻意做成「先不理 N 天」而不是永久隱藏:這些警示代表真的有東西卡住,
 * 永久藏起來等於把問題藏起來。時間到會自動再出現。
 */

export async function dismissDashboardAlertAction(payload: {
  kind: DismissibleAlertKind;
  targetId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole(["owner", "office_staff"]);

  if (!DISMISSIBLE_ALERT_KINDS.includes(payload.kind)) {
    return { ok: false, error: "警示類型不正確" };
  }
  if (typeof payload.targetId !== "string" || !payload.targetId) {
    return { ok: false, error: "缺少對象" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登入" };

  const until = new Date();
  until.setDate(until.getDate() + DISMISS_DAYS);

  // upsert:同一個人對同一項再按一次 = 重新計時
  const { error } = await supabase.from("dashboard_dismissals").upsert(
    {
      profile_id: user.id,
      alert_kind: payload.kind,
      target_id: payload.targetId,
      dismissed_until: until.toISOString(),
    },
    { onConflict: "profile_id,alert_kind,target_id" },
  );
  if (error) {
    // migration-2.30 還沒跑時會走到這裡
    return { ok: false, error: "忽略失敗：" + error.message };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

/** 復原自己所有忽略中的警示 */
export async function restoreDashboardAlertsAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  await requireRole(["owner", "office_staff"]);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登入" };

  const { error } = await supabase
    .from("dashboard_dismissals")
    .delete()
    .eq("profile_id", user.id);
  if (error) return { ok: false, error: "復原失敗：" + error.message };

  revalidatePath("/dashboard");
  return { ok: true };
}
