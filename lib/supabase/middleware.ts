import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname === "/login" ||
    // 使用說明書:免登入就能看(登入頁、給新員工的連結都指向它)
    pathname === "/manual.html" ||
    // 教學影片:跟說明書一樣免登入(速查卡的影片連結;新員工拿到帳號前就能先看)
    pathname.startsWith("/videos/") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    // Cron 用 CRON_SECRET bearer 守門,middleware 不擋(否則 Vercel Cron 會被重導到 /login)
    pathname.startsWith("/api/cron/") ||
    // LINE webhook 用 X-Line-Signature 守門(LINE 平台呼叫,沒有 Supabase session)
    pathname.startsWith("/api/line/") ||
    pathname === "/favicon.ico";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
