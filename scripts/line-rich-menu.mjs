/**
 * LINE Rich Menu 產生與部署工具(第一層:URI 按鈕連現有系統頁面)。
 *
 * 用法:
 *   node scripts/line-rich-menu.mjs render   # 只產 PNG 到 scripts/rich-menu-out/ 供預覽
 *   node scripts/line-rich-menu.mjs deploy   # 產圖 + 建立選單 + 上傳圖 + 綁 alias + 設預設
 *
 * deploy 需要 env LINE_CHANNEL_ACCESS_TOKEN(long-lived)。
 * 冪等:重跑會建新選單、把 alias 重新指向、設新預設,再刪掉舊的 yumin- 選單。
 *
 * 視覺(v2,依品牌書):
 *   - 頂部深邃海軍藍品牌横幅:銅金 badge + 思源宋體白字「裕民工務管理系統」
 *     (横幅本身也是按鈕 → 系統首頁)
 *   - 格區暖米白 + 海軍藍 8% 細格線(工程圖紙感),不用浮動卡片
 *   - 横幅字標維持思源宋體(工藝感);按鈕標籤用思源黑體 Bold —
 *     宋體當小尺寸按鈕字不夠清楚(Evelyn 2026-07-18 拍板),仍只有兩個字族
 *   - 銅金只出現在 logo(品牌鐵則:每頁最多一次)
 *   - 每個角色的主行動格 = 海軍藍實底反白
 *   - 需要系統已安裝 Source Han Serif TW(思源宋體)與 Noto Sans TC,
 *     Evelyn 的機器已確認有;沒有的機器跑 render 字體會 fallback,請先裝字體
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(SCRIPT_DIR, "..", "package.json"));
const sharp = require("sharp");

const BASE_URL = process.env.APP_BASE_URL ?? "https://yumin-admin.vercel.app";
const OUT_DIR = path.join(SCRIPT_DIR, "rich-menu-out");
/**
 * 銅金 badge(品牌定稿素材,在專案 parent 資料夾)。
 * 依序找:env 指定 → parent 資料夾的 SVG → 舊的 D:/Evelyn 路徑(專案搬家前)。
 * 找到 .svg 會先用 sharp 轉點陣再嵌進去 — SVG 裡直接 <image> 引 SVG,
 * librsvg 不一定畫得出來。
 */
const BADGE_CANDIDATES = [
  process.env.YUMIN_BADGE,
  path.join(SCRIPT_DIR, "..", "..", "yumin-badge-svg.svg"),
  "D:/Evelyn/yumin/Logo/yumin-badge-png.png",
].filter(Boolean);

const NAVY = "#003153";
const CREAM = "#F5F1EC";
const INK = "#5A5050";
/**
 * 「還有未核定」的提示點。用通知系統的待處理琥珀色(lib/line/flex.ts 的 amber),
 * 不用銅金 — 銅金是品牌 accent,鐵則是每張圖只出現一次(已給 logo)。
 */
const ALERT = "#D97706";
const NAVY_ON_NAVY_SUB = "#AFC2CF"; // 海軍藍底上的次要字
const SERIF = "Source Han Serif TW"; // 思源宋體(標題)
const SANS = "Noto Sans TC"; // 思源黑體(說明)

// ---------------------------------------------------------------------------
// 圖示(簡單線條 glyph;viewBox 0 0 48 48,stroke 繪製)
// ---------------------------------------------------------------------------
const ICONS = {
  clock: '<circle cx="24" cy="24" r="17"/><path d="M24 13v11l8 5"/>',
  pencil:
    '<path d="M10 38v-7L31 10l7 7-21 21h-7z"/><path d="M27 14l7 7"/>',
  camera:
    '<rect x="8" y="15" width="32" height="24" rx="3"/><path d="M18 15l3-5h6l3 5"/><circle cx="24" cy="27" r="7"/>',
  calendar:
    '<rect x="9" y="11" width="30" height="28" rx="3"/><path d="M9 20h30M17 7v8M31 7v8"/>',
  folder: '<path d="M8 12h12l4 5h16v21H8V12z"/>',
  book: '<path d="M24 12c-3-3-8-4-14-4v28c6 0 11 1 14 4 3-3 8-4 14-4V8c-6 0-11 1-14 4z"/><path d="M24 12v28"/>',
  check:
    '<rect x="9" y="9" width="30" height="30" rx="4"/><path d="M17 24l5 6 10-12"/>',
  gauge:
    '<path d="M8 32a16 16 0 1 1 32 0"/><path d="M24 32l8-9"/><circle cx="24" cy="32" r="2.5"/>',
  chart:
    '<path d="M9 39V9M9 39h30"/><path d="M16 32V22M24 32V15M32 32V26"/>',
  people:
    '<circle cx="18" cy="18" r="6"/><path d="M7 39c1-7 5-10 11-10s10 3 11 10"/><circle cx="33" cy="17" r="5"/><path d="M31 27c5 0 9 3 10 9"/>',
  person:
    '<circle cx="24" cy="16" r="8"/><path d="M9 41c2-9 7-13 15-13s13 4 15 13"/>',
  link: '<path d="M20 28l8-8"/><path d="M14 26l-4 4a7 7 0 0 0 10 10l4-4"/><path d="M34 22l4-4a7 7 0 0 0-10-10l-4 4"/>',
};

// ---------------------------------------------------------------------------
// 選單定義(label 大字、sub 一行說明)
// ---------------------------------------------------------------------------
const ROLE_MENUS = [
  {
    key: "site_supervisor",
    alias: "yumin-role-site-supervisor",
    name: "yumin-主任選單",
    cells: [
      { label: "打卡", sub: "GPS 上下班", icon: "clock", path: "/attendance", primary: true },
      { label: "寫日誌", sub: "今日施工紀錄", icon: "pencil", path: "/logs/new" },
      { label: "現場回報", sub: "拍照即時回報", icon: "camera", path: "/field-reports" },
      { label: "請假", sub: "申請與簽核進度", icon: "calendar", path: "/leaves" },
      { label: "我的案件", sub: "工地進度總覽", icon: "folder", path: "/my-cases" },
      { label: "說明書", sub: "操作教學", icon: "book", path: "/manual.html" },
    ],
  },
  {
    key: "field_assistant",
    alias: "yumin-role-field-assistant",
    name: "yumin-現場人員選單",
    cells: [
      { label: "打卡", sub: "GPS 上下班", icon: "clock", path: "/attendance", primary: true },
      { label: "新增回報", sub: "拍照即時回報", icon: "camera", path: "/field-reports/new" },
      { label: "我的回報", sub: "送出過的紀錄", icon: "folder", path: "/field-reports" },
      { label: "請假", sub: "申請與簽核進度", icon: "calendar", path: "/leaves" },
      { label: "我的帳號", sub: "綁定與通知設定", icon: "person", path: "/account" },
      { label: "說明書", sub: "操作教學", icon: "book", path: "/manual.html" },
    ],
  },
  {
    key: "office_staff",
    alias: "yumin-role-office-staff",
    name: "yumin-助理選單",
    cells: [
      { label: "待審核", sub: "日誌簽核", icon: "check", path: "/approvals", primary: true },
      { label: "案件", sub: "開案與管理", icon: "folder", path: "/cases" },
      { label: "請假", sub: "申請與簽核", icon: "calendar", path: "/leaves" },
      { label: "報表", sub: "出勤與進度匯出", icon: "chart", path: "/reports" },
      { label: "人員管理", sub: "帳號與通知", icon: "people", path: "/staff" },
      { label: "說明書", sub: "操作教學", icon: "book", path: "/manual.html" },
    ],
  },
  {
    key: "owner",
    alias: "yumin-role-owner",
    name: "yumin-老闆選單",
    cells: [
      { label: "待核定", sub: "簽名核定", icon: "check", path: "/approvals", primary: true },
      { label: "總覽", sub: "全公司健康燈號", icon: "gauge", path: "/dashboard" },
      { label: "案件", sub: "所有工地", icon: "folder", path: "/cases" },
      { label: "請假", sub: "簽核", icon: "calendar", path: "/leaves" },
      { label: "報表", sub: "出勤與進度", icon: "chart", path: "/reports" },
      { label: "說明書", sub: "操作教學", icon: "book", path: "/manual.html" },
    ],
  },
];

/**
 * 老闆選單的「還有未核定」版本(2026-08 Phil 要求)。
 *
 * Rich Menu 沒有動態徽章 — 只能事先做好兩張圖,再依狀態換掉那個人掛的選單
 * (runtime 在 lib/line/pending-menu.ts)。只做「有 / 沒有」兩態不做份數:
 * 份數要 11 張圖,而且漏掉任何一個觸發點數字就不準,不準比沒有更糟。
 *
 * 兩個差異:待核定格右上一顆琥珀點 + 說明字,以及 chatBarText —
 * chatBarText 是選單收合時聊天室底部那條 bar,選單沒點開也看得到,
 * 其實比格子裡的點更容易被注意到。
 */
const OWNER_MENU = ROLE_MENUS.find((m) => m.key === "owner");
const OWNER_PENDING_MENU = {
  ...OWNER_MENU,
  key: "owner_pending",
  alias: "yumin-role-owner-pending",
  name: "yumin-老闆選單-有待核定",
  chatBarText: "有待核定",
  cells: OWNER_MENU.cells.map((c) =>
    c.label === "待核定" ? { ...c, sub: "有單等你簽", dot: true } : c,
  ),
};

/** 走 2×3 格版型的選單(4 個角色 + 老闆的待核定版) */
const GRID_MENUS = [...ROLE_MENUS, OWNER_PENDING_MENU];

const DEFAULT_MENU = {
  key: "default",
  alias: "yumin-default",
  name: "yumin-未綁定預設選單",
  cells: [
    { label: "完成綁定", sub: "收通知・開啟專屬選單", icon: "link", path: "/account", primary: true },
    { label: "使用說明書", sub: "操作教學", icon: "book", path: "/manual.html" },
  ],
};

// ---------------------------------------------------------------------------
// SVG 產生
// ---------------------------------------------------------------------------
let badgeDataUri = null;
async function loadBadge() {
  if (badgeDataUri) return badgeDataUri;
  for (const candidate of BADGE_CANDIDATES) {
    let buf;
    try {
      buf = await readFile(candidate);
    } catch {
      continue; // 這台機器沒這個路徑,試下一個
    }
    if (candidate.toLowerCase().endsWith(".svg")) {
      buf = await sharp(buf, { density: 600 }).resize({ height: 460 }).png().toBuffer();
    }
    badgeDataUri = `data:image/png;base64,${buf.toString("base64")}`;
    return badgeDataUri;
  }
  throw new Error(
    `找不到品牌 badge,試過:\n  ${BADGE_CANDIDATES.join("\n  ")}\n` +
      `用 YUMIN_BADGE env 指定檔案路徑(.png 或 .svg)。`,
  );
}

function iconSvg(name, color, size, x, y, strokeWidth = 2.6) {
  return `<g transform="translate(${x},${y}) scale(${size / 48})" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>`;
}

/** 品牌横幅:海軍藍底 + 銅金 badge + 思源宋體白字 */
function brandBar(badge, W, barH, opts = {}) {
  const badgeH = opts.badgeH ?? Math.round(barH * 0.6);
  const badgeW = Math.round(badgeH * (335 / 460)); // badge 原始比例約 335:460
  const bx = opts.pad ?? 64;
  const by = Math.round((barH - badgeH) / 2);
  const titleSize = opts.titleSize ?? Math.round(barH * 0.4);
  const tx = bx + badgeW + 44;
  const ty = Math.round(barH / 2 + titleSize * 0.36);
  const en = opts.en ?? true;
  return `
  <rect width="${W}" height="${barH}" fill="${NAVY}"/>
  <image href="${badge}" x="${bx}" y="${by}" width="${badgeW}" height="${badgeH}"/>
  <text x="${tx}" y="${ty}" font-family="${SERIF}" font-weight="900" font-size="${titleSize}" fill="#F5F1EC" letter-spacing="10">裕民工務管理系統</text>
  ${
    en
      ? `<text x="${W - 64}" y="${ty - 4}" text-anchor="end" font-family="Noto Serif" font-size="${Math.round(titleSize * 0.42)}" fill="#7E97AC" letter-spacing="10">YU MIN DESIGN &amp; BUILD</text>`
      : ""
  }`;
}

/** 2×3 角色選單(2500×1686;頂部 150 品牌横幅) */
const ROLE_W = 2500;
const ROLE_H = 1686;
const ROLE_BAR_H = 150;
const ROLE_ROW_H = (ROLE_H - ROLE_BAR_H) / 2; // 768
const COL_X = [0, 833, 1666];
const COL_W = [833, 833, 834];

async function roleMenuSvg(menu) {
  const badge = await loadBadge();
  let cells = "";
  // 細格線(工程圖紙感)
  let grid = "";
  for (const gx of [833, 1666]) {
    grid += `<line x1="${gx}" y1="${ROLE_BAR_H}" x2="${gx}" y2="${ROLE_H}" stroke="${NAVY}" stroke-opacity="0.10" stroke-width="2"/>`;
  }
  grid += `<line x1="0" y1="${ROLE_BAR_H + ROLE_ROW_H}" x2="${ROLE_W}" y2="${ROLE_BAR_H + ROLE_ROW_H}" stroke="${NAVY}" stroke-opacity="0.10" stroke-width="2"/>`;

  menu.cells.forEach((cell, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = COL_X[col];
    const y = ROLE_BAR_H + row * ROLE_ROW_H;
    const w = COL_W[col];
    const fg = cell.primary ? "#FFFFFF" : NAVY;
    const subFg = cell.primary ? NAVY_ON_NAVY_SUB : INK;
    if (cell.primary) {
      cells += `<rect x="${x}" y="${y}" width="${w}" height="${ROLE_ROW_H}" fill="${NAVY}"/>`;
    }
    cells += `
      ${iconSvg(cell.icon, fg, 168, x + w / 2 - 84, y + 118)}
      <text x="${x + w / 2}" y="${y + 464}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="102" fill="${fg}" letter-spacing="8">${cell.label}</text>
      <text x="${x + w / 2}" y="${y + 586}" text-anchor="middle" font-family="${SANS}" font-size="44" fill="${subFg}" letter-spacing="6">${cell.sub}</text>`;
    // 「還有未核定」提示點:格子右上角,底色上加一圈同底色描邊拉開對比
    if (cell.dot) {
      const dx = x + w - 96;
      const dy = y + 96;
      const ring = cell.primary ? NAVY : CREAM;
      cells += `<circle cx="${dx}" cy="${dy}" r="38" fill="${ALERT}" stroke="${ring}" stroke-width="10"/>`;
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ROLE_W}" height="${ROLE_H}" viewBox="0 0 ${ROLE_W} ${ROLE_H}">
  <rect width="${ROLE_W}" height="${ROLE_H}" fill="${CREAM}"/>
  ${grid}
  ${brandBar(badge, ROLE_W, ROLE_BAR_H)}
  ${cells}
</svg>`;
}

/** 未綁定預設選單(2500×843;頂部 120 品牌横幅 + 兩格) */
const DEF_W = 2500;
const DEF_H = 843;
const DEF_BAR_H = 120;
const DEF_CELL_H = DEF_H - DEF_BAR_H; // 723

async function defaultMenuSvg(menu) {
  const badge = await loadBadge();
  let cells = "";
  cells += `<line x1="1250" y1="${DEF_BAR_H}" x2="1250" y2="${DEF_H}" stroke="${NAVY}" stroke-opacity="0.10" stroke-width="2"/>`;
  menu.cells.forEach((cell, i) => {
    const x = i * 1250;
    const y = DEF_BAR_H;
    const fg = cell.primary ? "#FFFFFF" : NAVY;
    const subFg = cell.primary ? NAVY_ON_NAVY_SUB : INK;
    if (cell.primary) {
      cells += `<rect x="${x}" y="${y}" width="1250" height="${DEF_CELL_H}" fill="${NAVY}"/>`;
    }
    cells += `
      ${iconSvg(cell.icon, fg, 160, x + 625 - 80, y + 92)}
      <text x="${x + 625}" y="${y + 424}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="106" fill="${fg}" letter-spacing="10">${cell.label}</text>
      <text x="${x + 625}" y="${y + 540}" text-anchor="middle" font-family="${SANS}" font-size="46" fill="${subFg}" letter-spacing="6">${cell.sub}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DEF_W}" height="${DEF_H}" viewBox="0 0 ${DEF_W} ${DEF_H}">
  <rect width="${DEF_W}" height="${DEF_H}" fill="${CREAM}"/>
  ${brandBar(badge, DEF_W, DEF_BAR_H, { titleSize: 52 })}
  ${cells}
</svg>`;
}

/** 點擊區域:品牌横幅 → 系統首頁;其餘格照排 */
function menuAreas(menu) {
  const uri = (p) => ({ type: "uri", uri: `${BASE_URL}${p}` });
  if (menu.key === "default") {
    return [
      { bounds: { x: 0, y: 0, width: DEF_W, height: DEF_BAR_H }, action: uri("/") },
      ...menu.cells.map((cell, i) => ({
        bounds: { x: i * 1250, y: DEF_BAR_H, width: 1250, height: DEF_CELL_H },
        action: uri(cell.path),
      })),
    ];
  }
  return [
    { bounds: { x: 0, y: 0, width: ROLE_W, height: ROLE_BAR_H }, action: uri("/") },
    ...menu.cells.map((cell, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      return {
        bounds: {
          x: COL_X[col],
          y: ROLE_BAR_H + row * ROLE_ROW_H,
          width: COL_W[col],
          height: ROLE_ROW_H,
        },
        action: uri(cell.path),
      };
    }),
  ];
}

async function renderAll() {
  await mkdir(OUT_DIR, { recursive: true });
  const files = new Map();
  for (const menu of GRID_MENUS) {
    const png = await sharp(Buffer.from(await roleMenuSvg(menu))).png().toBuffer();
    await writeFile(path.join(OUT_DIR, `${menu.key}.png`), png);
    files.set(menu.key, png);
    console.log(`rendered ${menu.key}.png (${Math.round(png.length / 1024)} KB)`);
  }
  const png = await sharp(Buffer.from(await defaultMenuSvg(DEFAULT_MENU))).png().toBuffer();
  await writeFile(path.join(OUT_DIR, "default.png"), png);
  files.set("default", png);
  console.log(`rendered default.png (${Math.round(png.length / 1024)} KB)`);
  return files;
}

// ---------------------------------------------------------------------------
// LINE API
// ---------------------------------------------------------------------------
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

async function lineApi(method, url, body, contentType = "application/json") {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": contentType } : {}),
    },
    body: body
      ? contentType === "application/json"
        ? JSON.stringify(body)
        : body
      : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function deploy() {
  if (!TOKEN) {
    console.error("缺 LINE_CHANNEL_ACCESS_TOKEN env");
    process.exit(1);
  }
  const images = await renderAll();

  const existing = await lineApi("GET", "https://api.line.me/v2/bot/richmenu/list");
  const oldIds = (existing.richmenus ?? [])
    .filter((m) => (m.name ?? "").startsWith("yumin-"))
    .map((m) => m.richMenuId);

  const aliasList = await lineApi(
    "GET",
    "https://api.line.me/v2/bot/richmenu/alias/list",
  );
  const existingAliases = new Set(
    (aliasList.aliases ?? []).map((a) => a.richMenuAliasId),
  );

  const allMenus = [...GRID_MENUS, DEFAULT_MENU];
  const created = {};
  for (const menu of allMenus) {
    const size =
      menu.key === "default"
        ? { width: DEF_W, height: DEF_H }
        : { width: ROLE_W, height: ROLE_H };
    const { richMenuId } = await lineApi(
      "POST",
      "https://api.line.me/v2/bot/richmenu",
      {
        size,
        selected: true,
        name: menu.name,
        chatBarText: menu.chatBarText ?? "功能選單",
        areas: menuAreas(menu),
      },
    );
    await lineApi(
      "POST",
      `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
      images.get(menu.key),
      "image/png",
    );
    if (existingAliases.has(menu.alias)) {
      await lineApi(
        "POST",
        `https://api.line.me/v2/bot/richmenu/alias/${menu.alias}`,
        { richMenuId },
      );
    } else {
      await lineApi("POST", "https://api.line.me/v2/bot/richmenu/alias", {
        richMenuAliasId: menu.alias,
        richMenuId,
      });
    }
    created[menu.key] = richMenuId;
    console.log(`created ${menu.name} → ${richMenuId} (alias ${menu.alias})`);
  }

  await lineApi(
    "POST",
    `https://api.line.me/v2/bot/user/all/richmenu/${created.default}`,
  );
  console.log("default rich menu set for all users");

  for (const id of oldIds) {
    if (Object.values(created).includes(id)) continue;
    await lineApi("DELETE", `https://api.line.me/v2/bot/richmenu/${id}`);
    console.log(`deleted old menu ${id}`);
  }

  console.log(
    "\ndeploy 完成。已綁定使用者的個人選單指向舊 id 的,傳任何訊息給官方帳號即自動換新(webhook 自癒)。",
  );
}

const cmd = process.argv[2];
if (cmd === "render") {
  await renderAll();
} else if (cmd === "deploy") {
  await deploy();
} else {
  console.log("用法: node scripts/line-rich-menu.mjs render|deploy");
  process.exit(1);
}
