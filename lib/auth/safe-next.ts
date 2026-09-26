/**
 * 登入後要去的頁面(`/login?next=…`):只接受站內路徑。
 *
 * 以前的檢查是 `startsWith("/") && !startsWith("//")`,擋不住 `/\evil.com`、
 * `/%5Cevil.com`、`/\t/evil.com` — 瀏覽器會把反斜線當成斜線、忽略 tab,
 * 變成 //evil.com 跳到外站(登入後被帶去假的「請重新輸入密碼」頁)。
 * 改用 URL 解析後比對 origin,解析出來不是本站就回首頁。
 */
export function safeNextPath(raw: string | null | undefined): string {
  const BASE = "https://yumin.invalid";
  if (!raw || !raw.startsWith("/")) return "/";
  try {
    const url = new URL(raw, BASE);
    if (url.origin !== BASE) return "/";
    const path = url.pathname + url.search + url.hash;
    return path.startsWith("//") ? "/" : path;
  } catch {
    return "/";
  }
}
