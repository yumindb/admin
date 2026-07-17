import type { LineMessage } from "./client";

/**
 * Flex Message 模板 — 依 line-integrator 設計原則:
 *   - 標題大、按鈕大(工地主任手指粗)
 *   - 最多 2 個 action button;摘要不超過 5 行
 *   - 顏色用 status 色:amber(待審)、green(通過)、red(退回)
 *   - 不含敏感資料(金額、簽名等細節進系統才看得到)
 */

export type NoticeTone = "amber" | "green" | "red";

const TONE_COLOR: Record<NoticeTone, string> = {
  amber: "#D97706",
  green: "#4A7C59",
  red: "#B91C1C",
};

/** 部署網址 — Vercel production;本機開發可用 APP_BASE_URL 蓋掉 */
export function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "https://yumin-admin.vercel.app";
}

export function textMessage(text: string): LineMessage {
  return { type: "text", text };
}

/**
 * 標準通知卡:色條標題 + 最多 5 行摘要 + 1 顆進系統按鈕。
 */
export function noticeFlex(input: {
  title: string;
  lines: string[];
  tone: NoticeTone;
  buttonLabel: string;
  buttonPath: string; // e.g. "/approvals" 或 `/logs/${id}`
}): LineMessage {
  const color = TONE_COLOR[input.tone];
  const uri = `${appBaseUrl()}${input.buttonPath}`;

  return {
    type: "flex",
    altText: input.title,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "16px",
        contents: [
          {
            type: "text",
            text: input.title,
            weight: "bold",
            size: "lg",
            color,
            wrap: true,
          },
          ...input.lines.slice(0, 5).map((line) => ({
            type: "text",
            text: line,
            size: "sm",
            color: "#5A5050",
            wrap: true,
          })),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#003153",
            height: "md",
            action: {
              type: "uri",
              label: input.buttonLabel,
              uri,
            },
          },
        ],
      },
    },
  };
}
