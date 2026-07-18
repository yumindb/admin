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
 * 設計:
 *   - 4 個角色選單(2500×1686,2×3 格)+ 1 個未綁定預設選單(2500×843,2 格)
 *   - 綁定完成時 webhook 依角色掛選單(lib/line/richmenu.ts);解綁退回預設
 *   - 品牌:暖米白底 #F5F1EC、深海軍藍 #003153、邊框 #E0DCD6;
 *     每個選單一格主行動用海軍藍實底(反白)
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
);
const sharp = require("sharp");

const BASE_URL = process.env.APP_BASE_URL ?? "https://yumin-admin.vercel.app";
const OUT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "rich-menu-out",
);

const NAVY = "#003153";
const CREAM = "#F5F1EC";
const BORDER = "#E0DCD6";
const INK = "#5A5050";
const FONT = "Microsoft JhengHei, PingFang TC, Noto Sans TC, sans-serif";

// ---------------------------------------------------------------------------
// 圖示(簡單線條 glyph;viewBox 0 0 48 48,stroke 繪製)
// ---------------------------------------------------------------------------
const ICONS = {
  clock:
    '<circle cx="24" cy="24" r="17"/><path d="M24 13v11l8 5"/>',
  pencil:
    '<path d="M10 38v-7L31 10l7 7-21 21h-7z"/><path d="M27 14l7 7"/>',
  camera:
    '<rect x="8" y="15" width="32" height="24" rx="3"/><path d="M18 15l3-5h6l3 5"/><circle cx="24" cy="27" r="7"/>',
  calendar:
    '<rect x="9" y="11" width="30" height="28" rx="3"/><path d="M9 20h30M17 7v8M31 7v8"/>',
  folder:
    '<path d="M8 12h12l4 5h16v21H8V12z"/>',
  book:
    '<path d="M24 12c-3-3-8-4-14-4v28c6 0 11 1 14 4 3-3 8-4 14-4V8c-6 0-11 1-14 4z"/><path d="M24 12v28"/>',
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
  link:
    '<path d="M20 28l8-8"/><path d="M14 26l-4 4a7 7 0 0 0 10 10l4-4"/><path d="M34 22l4-4a7 7 0 0 0-10-10l-4 4"/>',
};

// ---------------------------------------------------------------------------
// 選單定義
// ---------------------------------------------------------------------------
/** @type {Array<{key:string,alias:string,name:string,cells:Array<{label:string,icon:keyof typeof ICONS,path:string,primary?:boolean}>}>} */
const ROLE_MENUS = [
  {
    key: "site_supervisor",
    alias: "yumin-role-site-supervisor",
    name: "yumin-主任選單",
    cells: [
      { label: "打卡", icon: "clock", path: "/attendance", primary: true },
      { label: "寫日誌", icon: "pencil", path: "/logs/new" },
      { label: "現場回報", icon: "camera", path: "/field-reports" },
      { label: "請假", icon: "calendar", path: "/leaves" },
      { label: "我的案件", icon: "folder", path: "/my-cases" },
      { label: "說明書", icon: "book", path: "/manual.html" },
    ],
  },
  {
    key: "field_assistant",
    alias: "yumin-role-field-assistant",
    name: "yumin-現場人員選單",
    cells: [
      { label: "打卡", icon: "clock", path: "/attendance", primary: true },
      { label: "新增回報", icon: "camera", path: "/field-reports/new" },
      { label: "我的回報", icon: "folder", path: "/field-reports" },
      { label: "請假", icon: "calendar", path: "/leaves" },
      { label: "我的帳號", icon: "person", path: "/account" },
      { label: "說明書", icon: "book", path: "/manual.html" },
    ],
  },
  {
    key: "office_staff",
    alias: "yumin-role-office-staff",
    name: "yumin-助理選單",
    cells: [
      { label: "待審核", icon: "check", path: "/approvals", primary: true },
      { label: "案件", icon: "folder", path: "/cases" },
      { label: "請假", icon: "calendar", path: "/leaves" },
      { label: "報表", icon: "chart", path: "/reports" },
      { label: "人員管理", icon: "people", path: "/staff" },
      { label: "說明書", icon: "book", path: "/manual.html" },
    ],
  },
  {
    key: "owner",
    alias: "yumin-role-owner",
    name: "yumin-老闆選單",
    cells: [
      { label: "待核定", icon: "check", path: "/approvals", primary: true },
      { label: "總覽", icon: "gauge", path: "/dashboard" },
      { label: "案件", icon: "folder", path: "/cases" },
      { label: "請假", icon: "calendar", path: "/leaves" },
      { label: "報表", icon: "chart", path: "/reports" },
      { label: "說明書", icon: "book", path: "/manual.html" },
    ],
  },
];

const DEFAULT_MENU = {
  key: "default",
  alias: "yumin-default",
  name: "yumin-未綁定預設選單",
  cells: [
    { label: "完成綁定", sub: "收系統通知", icon: "link", path: "/account", primary: true },
    { label: "使用說明書", sub: "操作教學", icon: "book", path: "/manual.html" },
  ],
};

// ---------------------------------------------------------------------------
// SVG 產生
// ---------------------------------------------------------------------------
function iconSvg(name, color, size, x, y) {
  return `<g transform="translate(${x},${y}) scale(${size / 48})" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>`;
}

/** 2×3 角色選單(2500×1686) */
function roleMenuSvg(menu) {
  const W = 2500;
  const H = 1686;
  const COLS = 3;
  const cw = [833, 833, 834];
  const ch = 843;
  let cells = "";
  menu.cells.forEach((cell, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col === 0 ? 0 : col === 1 ? 833 : 1666;
    const y = row * ch;
    const w = cw[col];
    const pad = 26;
    const bg = cell.primary ? NAVY : "#FFFFFF";
    const fg = cell.primary ? "#FFFFFF" : NAVY;
    cells += `
      <rect x="${x + pad}" y="${y + pad}" width="${w - pad * 2}" height="${ch - pad * 2}" rx="20" fill="${bg}" stroke="${cell.primary ? NAVY : BORDER}" stroke-width="3"/>
      ${iconSvg(cell.icon, fg, 220, x + w / 2 - 110, y + 150)}
      <text x="${x + w / 2}" y="${y + 570}" text-anchor="middle" font-family="${FONT}" font-size="104" font-weight="700" fill="${fg}">${cell.label}</text>
      <text x="${x + w / 2}" y="${y + 680}" text-anchor="middle" font-family="${FONT}" font-size="44" fill="${cell.primary ? "#B8C7D1" : INK}">裕民工務管理系統</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${CREAM}"/>${cells}</svg>`;
}

/** 未綁定預設選單(2500×843,左右兩格) */
function defaultMenuSvg(menu) {
  const W = 2500;
  const H = 843;
  let cells = "";
  menu.cells.forEach((cell, i) => {
    const x = i * 1250;
    const pad = 30;
    const bg = cell.primary ? NAVY : "#FFFFFF";
    const fg = cell.primary ? "#FFFFFF" : NAVY;
    cells += `
      <rect x="${x + pad}" y="${pad}" width="${1250 - pad * 2}" height="${H - pad * 2}" rx="24" fill="${bg}" stroke="${cell.primary ? NAVY : BORDER}" stroke-width="3"/>
      ${iconSvg(cell.icon, fg, 240, x + 250, H / 2 - 120)}
      <text x="${x + 560}" y="${H / 2 - 20}" text-anchor="start" font-family="${FONT}" font-size="120" font-weight="700" fill="${fg}">${cell.label}</text>
      <text x="${x + 560}" y="${H / 2 + 110}" text-anchor="start" font-family="${FONT}" font-size="56" fill="${cell.primary ? "#B8C7D1" : INK}">${cell.sub}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${CREAM}"/>${cells}</svg>`;
}

function menuAreas(menu) {
  if (menu.key === "default") {
    return menu.cells.map((cell, i) => ({
      bounds: { x: i * 1250, y: 0, width: 1250, height: 843 },
      action: { type: "uri", uri: `${BASE_URL}${cell.path}` },
    }));
  }
  return menu.cells.map((cell, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    return {
      bounds: {
        x: col === 0 ? 0 : col === 1 ? 833 : 1666,
        y: row * 843,
        width: col === 2 ? 834 : 833,
        height: 843,
      },
      action: { type: "uri", uri: `${BASE_URL}${cell.path}` },
    };
  });
}

async function renderAll() {
  await mkdir(OUT_DIR, { recursive: true });
  const files = new Map();
  for (const menu of ROLE_MENUS) {
    const svg = roleMenuSvg(menu);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const file = path.join(OUT_DIR, `${menu.key}.png`);
    await writeFile(file, png);
    files.set(menu.key, png);
    console.log(`rendered ${file} (${Math.round(png.length / 1024)} KB)`);
  }
  const svg = defaultMenuSvg(DEFAULT_MENU);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const file = path.join(OUT_DIR, "default.png");
  await writeFile(file, png);
  files.set("default", png);
  console.log(`rendered ${file} (${Math.round(png.length / 1024)} KB)`);
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

  // 現有選單(等會兒刪掉舊的 yumin- 開頭)
  const existing = await lineApi(
    "GET",
    "https://api.line.me/v2/bot/richmenu/list",
  );
  const oldIds = (existing.richmenus ?? [])
    .filter((m) => (m.name ?? "").startsWith("yumin-"))
    .map((m) => m.richMenuId);

  // 現有 alias
  const aliasList = await lineApi(
    "GET",
    "https://api.line.me/v2/bot/richmenu/alias/list",
  );
  const existingAliases = new Set(
    (aliasList.aliases ?? []).map((a) => a.richMenuAliasId),
  );

  const allMenus = [...ROLE_MENUS, DEFAULT_MENU];
  const created = {};
  for (const menu of allMenus) {
    const size =
      menu.key === "default"
        ? { width: 2500, height: 843 }
        : { width: 2500, height: 1686 };
    const { richMenuId } = await lineApi(
      "POST",
      "https://api.line.me/v2/bot/richmenu",
      {
        size,
        selected: true, // 預設展開
        name: menu.name,
        chatBarText: "功能選單",
        areas: menuAreas(menu),
      },
    );
    await lineApi(
      "POST",
      `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
      images.get(menu.key),
      "image/png",
    );
    // alias:存在就重新指向,不存在就建立
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

  // 未綁定者的預設選單
  await lineApi(
    "POST",
    `https://api.line.me/v2/bot/user/all/richmenu/${created.default}`,
  );
  console.log("default rich menu set for all users");

  // 清舊選單(alias 已重新指向,舊的可以放心刪)
  for (const id of oldIds) {
    if (Object.values(created).includes(id)) continue;
    await lineApi("DELETE", `https://api.line.me/v2/bot/richmenu/${id}`);
    console.log(`deleted old menu ${id}`);
  }

  console.log("\ndeploy 完成。已綁定的使用者要「解除綁定→重新綁定」或等程式重掛才會換角色選單。");
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
