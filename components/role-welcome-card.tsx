"use client";

import { useEffect, useState } from "react";

/**
 * 首次登入的角色歡迎小卡 —— 依角色列出「最基本的 3-4 件事」,讓人不被系統嚇到。
 *
 * 顯示時機:登入後任一頁載入時,若這台裝置沒被「以後不再顯示」過就彈一次。
 * 記憶方式:localStorage(裝置-local,不進 DB,不需 migration)。
 *   - 勾「以後不再顯示」→ 永久記住(localStorage)
 *   - 不勾直接關 → 只記這個 session(sessionStorage),下次登入還會親切提醒一次
 *
 * 內容與 /manual.html 的「角色速查卡」同一套,改版時兩邊一起更新。
 */

type Role = "field_assistant" | "site_supervisor" | "office_staff" | "owner";

type CardDef = {
  title: string;
  color: string;
  line: string;
  items: [string, string][];
  manualHash: string;
};

const CARDS: Record<Role, CardDef> = {
  field_assistant: {
    title: "現場人員",
    color: "#4A7C59",
    line: "你只要顧好兩件事：打卡、拍照回報。",
    items: [
      ["到工地", "按底部「打卡」→ 上班打卡；收工按下班打卡。"],
      ["看到狀況", "按底部「新增」→ 拍照、寫一句話 → 送出。"],
      ["要請假", "按底部「請假」→ 新請假，系統會自動往上送。"],
    ],
    manualHash: "field",
  },
  site_supervisor: {
    title: "工地主任",
    color: "#2C577E",
    line: "每天收工花五分鐘填一份日誌，就完成大半工作。",
    items: [
      ["填日誌", "「日誌」→ 新日誌：勾工項、按數量、簽名、送出。"],
      ["打卡", "到工地按底部「打卡」。"],
      ["臨時追加的工作", "填日誌時按「新增臨時項」記一筆。"],
      ["幫忙簽假單", "「請假」出現紅色數字時，點進去核准。"],
    ],
    manualHash: "supervisor",
  },
  office_staff: {
    title: "辦公室助理",
    color: "#A07850",
    line: "案件和帳的管家 —— 畫面上的紅色數字，點進去處理就對了。",
    items: [
      ["開案 + 匯標單", "「案件總覽」→ 開新案件 → 匯入工項。"],
      ["審核日誌", "上方「待審核」有紅字 → 點開對數量 → 通過或退回。"],
      ["月底追加收款", "未簽約 → 補單價 → 打包成追加合約。"],
      ["有人忘打卡", "「報表 → 現場出勤」按「補登打卡」。"],
    ],
    manualHash: "office",
  },
  owner: {
    title: "老闆",
    color: "#003153",
    line: "綠色不用管，黃色瞄一眼，紅色點進去。",
    items: [
      ["早上滑儀表板", "有紅燈點進去，沒紅燈就放心。"],
      ["核定日誌", "「待核定」→ 看照片 → 簽名核定（可一次批簽多份）。"],
      ["看現場照片", "手機底部「回報」隨時看得到現場拍的照片。"],
    ],
    manualHash: "boss",
  },
};

const STORAGE_KEY = "yumin_welcome_v1";

export function RoleWelcomeCard({ role, fullName }: { role: string; fullName: string }) {
  const [open, setOpen] = useState(false);
  const [dontShow, setDontShow] = useState(true);

  const card = CARDS[role as Role];

  useEffect(() => {
    if (!card) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") return; // 永久關過
      if (sessionStorage.getItem(STORAGE_KEY) === "1") return; // 這個 session 關過
      setOpen(true);
    } catch {
      // 隱私模式等 storage 不可用 → 就當作沒關過,顯示一次(不會壞)
      setOpen(true);
    }
  }, [card]);

  if (!card || !open) return null;

  function close() {
    try {
      if (dontShow) localStorage.setItem(STORAGE_KEY, "1");
      else sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* storage 不可用就算了,下次再顯示無妨 */
    }
    setOpen(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="歡迎使用"
      onClick={close}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-t-2xl border border-[#E0DCD6] bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="px-6 pt-6 pb-4" style={{ background: card.color }}>
          <div className="text-sm text-white/80">歡迎，{fullName}</div>
          <div className="mt-1 flex items-center gap-2">
            <h2 className="text-2xl font-semibold text-white">{card.title}</h2>
            <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs text-white">
              你的角色
            </span>
          </div>
          <p className="mt-2 text-[15px] leading-relaxed text-white/90">{card.line}</p>
        </div>

        {/* 3-4 件基本的事 */}
        <div className="px-6 py-5">
          <div className="mb-3 text-sm font-medium text-muted-foreground">
            你平常只要做這幾件事：
          </div>
          <ul className="space-y-3">
            {card.items.map(([label, desc], i) => (
              <li key={i} className="flex gap-3">
                <span
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                  style={{ background: card.color }}
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-primary">{label}</div>
                  <div className="text-sm text-muted-foreground">{desc}</div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 rounded-md border border-[#E0DCD6] bg-[#FAF7F2] px-3 py-2.5 text-sm text-muted-foreground">
            需要更詳細的步驟、或用聽的？
            <a
              href={`/manual.html#${card.manualHash}`}
              target="_blank"
              rel="noopener"
              className="ml-1 font-medium text-accent underline underline-offset-2"
            >
              打開完整說明書
            </a>
            （之後隨時可按右上角的「?」再打開）。
          </div>
        </div>

        {/* footer */}
        <div className="flex flex-col gap-3 border-t border-[#E0DCD6] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="size-4 accent-primary"
            />
            以後不再顯示
          </label>
          <button
            type="button"
            onClick={close}
            className="h-11 rounded-md bg-primary px-6 text-base font-medium text-primary-foreground hover:bg-primary/90"
          >
            開始使用
          </button>
        </div>
      </div>
    </div>
  );
}
