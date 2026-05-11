import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// 短跑 — 只做一次 UPDATE,不會超過 5 秒。
export const maxDuration = 30;

/**
 * 把卡在 pdf_status='generating' 太久(>10 分鐘)的日誌翻成 'failed',
 * 讓 UI 顯示「重新產生」按鈕,使用者不會被永遠的 spinner 卡住。
 *
 * 為什麼會卡:
 *   approveStageAction 用 after() 在背景產 PDF;Vercel function 預設 timeout
 *   60 秒,如果 PDF 因照片太多或外部依賴慢於 timeout,process 被殺,
 *   pdf_status 留在 'generating' 永遠不會被翻 done/failed。
 *
 * 觸發:每小時整點(見 vercel.json)。
 *
 * 為什麼用 service-role:
 *   要跨所有使用者翻狀態,RLS 擋的就是這種跨人寫入。
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
  if (stuckIds.length === 0) {
    return NextResponse.json({ ok: true, flipped: 0 });
  }

  // 翻成 failed,讓 UI 顯示「重新產生」按鈕
  const { error: updErr } = await supabase
    .from("daily_logs")
    .update({
      pdf_status: "failed",
      pdf_error: "PDF 產生超過 10 分鐘無回應,背景任務可能已中斷,請點重新產生。",
    })
    .in("id", stuckIds);

  if (updErr) {
    console.error("[recheck-stuck-pdfs] update failed:", updErr.message);
    return NextResponse.json(
      { ok: false, error: updErr.message },
      { status: 500 },
    );
  }

  console.warn(
    `[recheck-stuck-pdfs] flipped ${stuckIds.length} stuck PDF(s) to failed:`,
    stuckIds,
  );
  return NextResponse.json({ ok: true, flipped: stuckIds.length, ids: stuckIds });
}
