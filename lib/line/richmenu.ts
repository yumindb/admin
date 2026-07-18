import { isLineConfigured } from "./client";
import type { UserRole } from "@/lib/types";

/**
 * Rich Menu 依角色切換 — runtime 端。
 *
 * 選單本體由 scripts/line-rich-menu.mjs 建立,每個角色一個固定 alias;
 * 這裡在「綁定完成」時把角色選單掛到該 LINE 使用者身上,
 * 「解除綁定」時解掛(退回未綁定預設選單)。
 * alias → richMenuId 用 module-level cache(serverless instance 存活期間有效,
 * 選單重新部署後最多 10 分鐘內換新)。
 *
 * 全部函式絕不 throw — Rich Menu 掛失敗不能影響綁定主流程。
 */

const ALIAS_BY_ROLE: Record<UserRole, string> = {
  owner: "yumin-role-owner",
  office_staff: "yumin-role-office-staff",
  site_supervisor: "yumin-role-site-supervisor",
  field_assistant: "yumin-role-field-assistant",
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const aliasCache = new Map<string, { id: string; at: number }>();

async function resolveAlias(aliasId: string): Promise<string | null> {
  const hit = aliasCache.get(aliasId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.id;
  try {
    const res = await fetch(
      `https://api.line.me/v2/bot/richmenu/alias/${aliasId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      },
    );
    if (!res.ok) {
      // alias 還沒建立(script 沒跑過)→ 安靜跳過
      return null;
    }
    const data = (await res.json()) as { richMenuId?: string };
    if (!data.richMenuId) return null;
    aliasCache.set(aliasId, { id: data.richMenuId, at: Date.now() });
    return data.richMenuId;
  } catch (e) {
    console.error("[richmenu] alias 解析失敗:", aliasId, e);
    return null;
  }
}

/** 綁定完成 / 角色變更時:把角色選單掛到這個 LINE 使用者 */
export async function linkRoleRichMenu(
  lineUserId: string,
  role: UserRole,
): Promise<void> {
  if (!isLineConfigured()) return;
  const alias = ALIAS_BY_ROLE[role];
  if (!alias) return;
  const richMenuId = await resolveAlias(alias);
  if (!richMenuId) return;
  try {
    const res = await fetch(
      `https://api.line.me/v2/bot/user/${lineUserId}/richmenu/${richMenuId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      },
    );
    if (!res.ok) {
      console.error(
        `[richmenu] link 失敗 (${role}):`,
        res.status,
        (await res.text()).slice(0, 200),
      );
    }
  } catch (e) {
    console.error("[richmenu] link 連線失敗:", e);
  }
}

/** 解除綁定時:解掛個人選單,退回未綁定預設選單 */
export async function unlinkRichMenu(lineUserId: string): Promise<void> {
  if (!isLineConfigured()) return;
  try {
    await fetch(`https://api.line.me/v2/bot/user/${lineUserId}/richmenu`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    });
  } catch (e) {
    console.error("[richmenu] unlink 失敗:", e);
  }
}
