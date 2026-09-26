import { z } from "zod";
import { tryGetActor } from "@/lib/auth/require-role";
import { createServiceClient } from "@/lib/supabase/server";
import { insertErrorLog } from "@/lib/monitor/server";

/**
 * 瀏覽器端錯誤回報(lib/monitor/client.ts 用 sendBeacon 送來)→ error_logs。
 *
 * - 只收已登入的人(proxy 也會把未登入的請求導走)
 * - 內容長度有上限、每人 10 分鐘最多 30 則,避免有 bug 在迴圈裡灌爆或被拿來塞資料
 * - 一律回 204:瀏覽器端不需要知道結果
 */

const BodySchema = z.object({
  kind: z.enum(["boundary", "global", "window", "promise"]),
  level: z.enum(["error", "warn"]).default("error"),
  message: z.string().trim().min(1).max(1000),
  stack: z.string().max(4000).nullish(),
  digest: z.string().max(100).nullish(),
  path: z.string().max(300).nullish(),
});

const MAX_BODY_BYTES = 16 * 1024;
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 30;

const noContent = () => new Response(null, { status: 204 });

export async function POST(request: Request) {
  try {
    const actor = await tryGetActor();
    if (!actor) return noContent();

    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return noContent();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return noContent();
    }
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) return noContent();

    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count } = await createServiceClient()
      .from("error_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", actor.id)
      .eq("source", "client")
      .gte("occurred_at", since);
    if ((count ?? 0) >= RATE_MAX) return noContent();

    const body = parsed.data;
    await insertErrorLog({
      source: "client",
      level: body.level,
      message: body.message,
      stack: body.stack ?? null,
      digest: body.digest ?? null,
      path: body.path ?? null,
      routeType: body.kind,
      userId: actor.id,
      role: actor.role,
      userAgent: request.headers.get("user-agent"),
    });
  } catch {
    // 回報端點本身出錯也不回錯誤給瀏覽器
  }
  return noContent();
}
