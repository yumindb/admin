/**
 * DB 錯誤訊息包裝 — 避免把 Postgres / supabase-js 的內部訊息(欄位名、constraint 名)
 * 直接吐給 client。實作習慣:
 *
 *   const { error } = await supabase.from("x").insert(...);
 *   if (error) throw wrapDbError(error, "儲存失敗");
 *
 * 內部訊息會 console.error(server log 看得到方便 debug),
 * 回給 client 的 Error.message 只有人類可讀的中文。
 */
export function wrapDbError(err: unknown, userMessage: string): Error {
  // 內部 log 完整錯誤
  if (err instanceof Error) {
    console.error("[wrapDbError]", err.message, err);
  } else {
    console.error("[wrapDbError]", err);
  }
  return new Error(userMessage);
}
