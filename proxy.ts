import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // 靜態檔(圖片、影片、說明書 html、manifest)不經過 proxy。
    // ⚠ prefetch 請求不要排除:token 過期時要在這裡換新並寫回 cookie;
    //   若讓 prefetch 繞過 proxy,換新會發生在 Server Component 裡(寫不回 cookie),
    //   refresh token 被用掉卻沒存下來,之後可能整個 session 被 Supabase 作廢。
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm|html|webmanifest|txt|xml)$).*)",
  ],
};
