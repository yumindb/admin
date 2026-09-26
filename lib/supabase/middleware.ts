import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { MONITOR_HEADERS, MONITOR_HEADER_PREFIX } from "@/lib/monitor/shared";

/** 不需登入的路徑 — 不驗身分、不刷新 session,直接放行 */
function isPublicPath(pathname: string): boolean {
  return (
    // 使用說明書:免登入就能看(登入頁、給新員工的連結都指向它)
    pathname === "/manual.html" ||
    // 教學影片:跟說明書一樣免登入(速查卡的影片連結;新員工拿到帳號前就能先看)
    pathname.startsWith("/videos/") ||
    pathname.startsWith("/_next") ||
    // Cron 用 CRON_SECRET bearer 守門,proxy 不擋(否則 Vercel Cron 會被重導到 /login)
    pathname.startsWith("/api/cron/") ||
    // LINE webhook 用 X-Line-Signature 守門(LINE 平台呼叫,沒有 Supabase session)
    pathname.startsWith("/api/line/") ||
    pathname === "/favicon.ico"
  );
}

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function updateSession(request: NextRequest) {
  const startedAt = Date.now();
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  let cookiesToSet: CookieToSet[] = [];
  let noCacheHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet, headers) {
          // 換新的 token 寫回 request(讓後面的頁面讀到新的)並記下來,最後貼到 response
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet = toSet;
          noCacheHeaders = headers ?? {};
        },
      },
    },
  );

  const withSessionCookies = (response: NextResponse) => {
    cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    Object.entries(noCacheHeaders).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  };

  if (pathname === "/login") {
    // 已登入的人不需要看登入頁。這裡用 getUser()(問 Auth server)而不是 getClaims():
    // 被停用的帳號 JWT 在過期前仍驗得過,若只看 JWT 會在「頁面踢回 /login ↔ /login 彈回首頁」之間無限循環。
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return withSessionCookies(NextResponse.redirect(url));
    }
    return withSessionCookies(NextResponse.next({ request }));
  }

  // 其餘頁面:本機驗 JWT 簽章(ES256 公鑰有快取),不用每個請求都打一趟 Auth server。
  // token 快過期時 getClaims() 會先換新(走 setAll)。
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub ?? null;

  if (!userId) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // 系統監控(lib/monitor):把起始時間、request id、user id 帶給後面的頁面 / server action。
  // client 自己送來的同名 header 一律清掉,只信任這裡寫的值。
  const forwarded = new Headers(request.headers);
  for (const key of [...forwarded.keys()]) {
    if (key.startsWith(MONITOR_HEADER_PREFIX)) forwarded.delete(key);
  }
  forwarded.set(MONITOR_HEADERS.start, String(startedAt));
  forwarded.set(MONITOR_HEADERS.requestId, crypto.randomUUID());
  forwarded.set(MONITOR_HEADERS.userId, userId);
  forwarded.set(MONITOR_HEADERS.path, pathname);

  return withSessionCookies(NextResponse.next({ request: { headers: forwarded } }));
}
