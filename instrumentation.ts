import type { Instrumentation } from "next";

/**
 * 伺服器端錯誤 → error_logs(系統監控的「錯誤紀錄」頁)。
 * Next 在 Server Component render、server action、route handler、proxy 丟出錯誤時呼叫。
 * 記錄失敗不能影響原本的錯誤處理,所以整段吞掉自己的例外。
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { recordServerError } = await import("@/lib/monitor/server");
    await recordServerError(err, request, context);
  } catch {
    // ignore
  }
};
