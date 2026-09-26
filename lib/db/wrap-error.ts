import { markLogged, reportDbError } from "@/lib/monitor/server";

/**
 * DB 錯誤訊息包裝 — 避免把 Postgres / supabase-js 的內部訊息(欄位名、constraint 名)
 * 直接吐給 client。實作習慣:
 *
 *   const { error } = await supabase.from("x").insert(...);
 *   if (error) throw wrapDbError(error, "儲存失敗");
 *
 * 內部訊息會 console.error(server log 看得到方便 debug),並寫進系統監控的
 * 「錯誤紀錄」(error_logs,source = db;回應送完才寫)。
 * 回給 client 的 Error.message 只有人類可讀的中文;原始錯誤掛在 `cause`,
 * 並標記「已記錄」,之後 onRequestError 看到同一個錯誤就不會再記一次。
 */
export function wrapDbError(err: unknown, userMessage: string): Error {
  // 內部 log 完整錯誤
  if (err instanceof Error) {
    console.error("[wrapDbError]", err.message, err);
  } else {
    console.error("[wrapDbError]", err);
  }
  reportDbError(err, userMessage);
  const wrapped = new Error(userMessage, { cause: err });
  markLogged(wrapped);
  return wrapped;
}
