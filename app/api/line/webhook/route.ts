import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  isLineConfigured,
  replyLineMessage,
  verifyLineSignature,
} from "@/lib/line/client";
import { looksLikeBindingCode } from "@/lib/line/binding";
import { UNBIND_KEYWORD } from "@/lib/line/constants";
import { textMessage } from "@/lib/line/flex";
import { linkRoleRichMenu, unlinkRichMenu } from "@/lib/line/richmenu";
import type { UserRole } from "@/lib/types";

/**
 * LINE 官方帳號 webhook 入口。
 *
 * 安全:
 *   - 每個 request 都驗 X-Line-Signature(HMAC-SHA256 with channel secret);
 *     驗不過回 401,事件一律不處理
 *   - middleware 對 /api/line/ 放行(LINE 平台呼叫,沒有 Supabase session)
 *   - DB 寫入走 service-role(webhook 沒有使用者 session)
 *
 * 支援的事件:
 *   follow          → 回覆綁定引導
 *   message(text):
 *     6 位數字      → 綁定碼比對 → 寫入 line_user_id 完成綁定
 *     「解除綁定」  → 清除綁定
 *     其他          → 未綁定的人回引導;已綁定的人不回(避免騷擾)
 *   unfollow        → 自動解除綁定(封鎖後推播必失敗,直接清掉)
 *
 * 回覆(reply)免費不計額度;這裡不用 push。
 */

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
};

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!isLineConfigured()) {
    // 金鑰還沒設定(部署早於 LINE 後台設定完成)— 安靜回 200,不處理
    return NextResponse.json({ ok: true, note: "LINE 未設定" });
  }

  const signature = request.headers.get("x-line-signature");
  if (!verifyLineSignature(rawBody, signature)) {
    return NextResponse.json({ ok: false, error: "signature 驗證失敗" }, { status: 401 });
  }

  let events: LineEvent[] = [];
  try {
    const parsed = JSON.parse(rawBody) as { events?: LineEvent[] };
    events = parsed.events ?? [];
  } catch {
    return NextResponse.json({ ok: false, error: "body 不是 JSON" }, { status: 400 });
  }

  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[line-webhook] 事件處理失敗:", event.type, msg);
    }
  }

  return NextResponse.json({ ok: true });
}

const GUIDE_TEXT =
  "請先登入裕民工務系統,到「我的帳號」頁點「產生綁定碼」,再把 6 位數字傳到這裡,之後簽核、請假的通知就會自動傳給你。";

async function handleEvent(event: LineEvent): Promise<void> {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === "follow") {
    if (event.replyToken) {
      await replyLineMessage(event.replyToken, [
        textMessage(`歡迎加入裕民工務通知帳號!\n${GUIDE_TEXT}`),
      ]);
    }
    return;
  }

  if (event.type === "unfollow") {
    // 封鎖 = 收不到推播,直接視為解綁
    const supabase = createServiceClient();
    await supabase
      .from("line_bindings")
      .update({ line_user_id: null, bound_at: null })
      .eq("line_user_id", userId);
    return;
  }

  if (event.type !== "message" || event.message?.type !== "text") return;
  const text = (event.message.text ?? "").trim();
  const replyToken = event.replyToken;

  if (text === UNBIND_KEYWORD) {
    const supabase = createServiceClient();
    const { data: rows } = await supabase
      .from("line_bindings")
      .update({ line_user_id: null, bound_at: null })
      .eq("line_user_id", userId)
      .select("profile_id");
    if (rows && rows.length > 0) {
      // 解綁 → 退回未綁定預設選單
      await unlinkRichMenu(userId);
    }
    if (replyToken) {
      await replyLineMessage(replyToken, [
        textMessage(
          rows && rows.length > 0
            ? "已解除綁定,不會再收到系統通知。想重新綁定,到「我的帳號」再產生一次綁定碼就可以。"
            : "這個 LINE 目前沒有綁定任何系統帳號。",
        ),
      ]);
    }
    return;
  }

  if (looksLikeBindingCode(text)) {
    await handleBindingCode(userId, text, replyToken);
    return;
  }

  // 其他訊息:未綁定的人給引導;已綁定的人不回嘴,但順手重掛 Rich Menu
  // (自癒:綁定當下若選單掛失敗〔部署時間差、LINE 暫時性錯誤〕,
  //  之後本人隨便傳一句話就會補掛,不用解綁重綁)
  const supabase = createServiceClient();
  const { data: bound } = await supabase
    .from("line_bindings")
    .select("profile_id")
    .eq("line_user_id", userId)
    .maybeSingle();
  if (!bound) {
    if (replyToken) {
      await replyLineMessage(replyToken, [textMessage(GUIDE_TEXT)]);
    }
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", bound.profile_id)
    .maybeSingle();
  if (profile?.role) {
    await linkRoleRichMenu(userId, profile.role as UserRole);
    if (profile.role === "owner") {
      const { syncOwnerApprovalMenus } = await import("@/lib/line/pending-menu");
      await syncOwnerApprovalMenus();
    }
  }
  // 明確喊「選單」的人給個回饋,其他訊息保持安靜
  if (text === "選單" && replyToken) {
    await replyLineMessage(replyToken, [
      textMessage("已重新整理你的選單。看不到的話,把聊天室關掉再打開一次。"),
    ]);
  }
}

async function handleBindingCode(
  userId: string,
  code: string,
  replyToken: string | undefined,
): Promise<void> {
  const supabase = createServiceClient();

  const { data: binding } = await supabase
    .from("line_bindings")
    .select("profile_id, binding_code_expires_at")
    .eq("binding_code", code)
    .maybeSingle();

  const expired =
    !binding?.binding_code_expires_at ||
    new Date(binding.binding_code_expires_at as string).getTime() < Date.now();

  if (!binding || expired) {
    if (replyToken) {
      await replyLineMessage(replyToken, [
        textMessage("綁定碼錯誤或已過期,請回系統「我的帳號」重新產生一組再試。"),
      ]);
    }
    return;
  }

  // 這個 LINE 已綁在別的系統帳號上 → 請先解綁,避免默默把別人的通知搶過來
  const { data: existing } = await supabase
    .from("line_bindings")
    .select("profile_id")
    .eq("line_user_id", userId)
    .neq("profile_id", binding.profile_id)
    .maybeSingle();
  if (existing) {
    if (replyToken) {
      await replyLineMessage(replyToken, [
        textMessage(
          `這個 LINE 已綁定另一個系統帳號。若要換綁,請先傳「${UNBIND_KEYWORD}」解除,再重新輸入綁定碼。`,
        ),
      ]);
    }
    return;
  }

  const { error: updErr } = await supabase
    .from("line_bindings")
    .update({
      line_user_id: userId,
      bound_at: new Date().toISOString(),
      binding_code: null,
      binding_code_expires_at: null,
    })
    .eq("profile_id", binding.profile_id)
    .eq("binding_code", code);
  if (updErr) {
    console.error("[line-webhook] 綁定寫入失敗:", updErr.message);
    if (replyToken) {
      await replyLineMessage(replyToken, [
        textMessage("綁定失敗,請稍後再試,或聯絡辦公室協助。"),
      ]);
    }
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", binding.profile_id)
    .maybeSingle();
  const name = (profile?.full_name as string | undefined) ?? "";

  // 依角色掛 Rich Menu(失敗不影響綁定)
  if (profile?.role) {
    await linkRoleRichMenu(userId, profile.role as UserRole);
    if (profile.role === "owner") {
      const { syncOwnerApprovalMenus } = await import("@/lib/line/pending-menu");
      await syncOwnerApprovalMenus();
    }
  }

  if (replyToken) {
    await replyLineMessage(replyToken, [
      textMessage(
        `${name ? name + ",": ""}綁定成功!之後簽核、請假、回報的通知都會傳到這裡,下方選單也換成你的常用功能了。\n想暫停通知可以到系統「我的帳號」關閉,或傳「${UNBIND_KEYWORD}」。`,
      ),
    ]);
  }
}
