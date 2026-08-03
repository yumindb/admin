import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { cleanupOldLogs } from "@/lib/retention";
import { retryPendingNotifications } from "@/lib/notifications/notify";
import { syncOwnerApprovalMenus } from "@/lib/line/pending-menu";

// 三個工作合併:PDF flip 數秒,retention 數秒,通知重試最多 50 則。
export const maxDuration = 60;

/**
 * 夜間 housekeeping(3 個工作 — 為了不超過 Vercel Hobby plan 的 2-cron 上限,
 * 共用同一個 endpoint 一次跑完):
 *
 *   1. 把卡在 pdf_status='generating' 太久(>10 分鐘)的日誌翻成 'failed'
 *   2. 清理過期的 login_attempts / daily_log_revisions / audit_logs(見 lib/retention)
 *   3. 重試沒送成的 LINE 通知 + 清 30 天前的 notification_queue(見 lib/notifications)
 *   4. 重算老闆 Rich Menu 的「還有未核定」狀態(見 lib/line/pending-menu)—
 *      平常由簽核事件即時同步,這裡只是兜底,防某次事件同步失敗後一直錯下去
 *
 * 觸發:每天 UTC 16:00(台北 00:00),見 vercel.json。
 *
 * 為什麼用 service-role:
 *   要跨所有使用者翻狀態 / 刪 audit 資料(audit_logs 沒開 DELETE policy)。
 *   API endpoint 用 CRON_SECRET 守門,只能由 Vercel Cron 觸發。
 */

const STUCK_THRESHOLD_MS = 10 * 60 * 1000;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "未授權" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();

  // 找出卡住的(pdf_status='generating' 且 updated_at 早於 10 分鐘前)
  const { data: stuck, error: selErr } = await supabase
    .from("daily_logs")
    .select("id, updated_at")
    .eq("pdf_status", "generating")
    .lt("updated_at", cutoff);

  if (selErr) {
    console.error("[recheck-stuck-pdfs] select failed:", selErr.message);
    return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 });
  }

  const stuckIds = (stuck ?? []).map((r) => r.id as string);
  let flippedCount = 0;
  if (stuckIds.length > 0) {
    const { error: updErr } = await supabase
      .from("daily_logs")
      .update({
        pdf_status: "failed",
        pdf_error: "PDF 產生超過 10 分鐘無回應，背景任務可能已中斷，請點重新產生。",
      })
      .in("id", stuckIds);

    if (updErr) {
      console.error("[recheck-stuck-pdfs] update failed:", updErr.message);
      return NextResponse.json(
        { ok: false, error: updErr.message },
        { status: 500 },
      );
    }
    flippedCount = stuckIds.length;
    console.warn(
      `[recheck-stuck-pdfs] flipped ${flippedCount} stuck PDF(s) to failed:`,
      stuckIds,
    );
  }

  // 第二件事:retention 清理(login_attempts / daily_log_revisions / audit_logs)
  const retention = await cleanupOldLogs(supabase);
  const retentionError = retention.find((r) => r.error !== null);
  if (retentionError) {
    console.error(
      `[recheck-stuck-pdfs] retention cleanup failed for ${retentionError.table}:`,
      retentionError.error,
    );
  }

  // 第三件事:LINE 通知重試 + 佇列清理
  const notifications = await retryPendingNotifications(supabase);
  if (notifications.error) {
    console.error(
      "[recheck-stuck-pdfs] notification retry failed:",
      notifications.error,
    );
  }

  // 第四件事:老闆選單「還有未核定」狀態兜底重算(自己吞例外,不影響上面三件)
  await syncOwnerApprovalMenus();

  return NextResponse.json({
    ok: !retentionError && !notifications.error,
    flipped: flippedCount,
    ids: stuckIds,
    retention,
    notifications,
  });
}
