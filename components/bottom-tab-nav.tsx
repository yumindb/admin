"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type IconName =
  | "list"
  | "plus"
  | "check"
  | "folder"
  | "camera"
  | "users"
  | "file"
  | "clock"
  | "home";

export type BottomTab = {
  href: string;
  label: string;
  icon: IconName;
};

/**
 * Mobile webapp-style 底部 tab bar。每個角色不同 tabs。
 * 桌機端會被 md:hidden 隱藏 — 桌機改走 top nav。
 */
export function BottomTabNav({ tabs }: { tabs: BottomTab[] }) {
  const pathname = usePathname() ?? "";
  if (tabs.length === 0) return null;

  return (
    <nav
      aria-label="主要導覽"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E0DCD6] bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(0,0,0,0.04)] md:hidden"
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}
      >
        {tabs.map((tab) => {
          const active = isTabActive(pathname, tab.href);
          // active 加 2px 銅金頂條 + 暖米白底,工地強光下一眼看出當前所在分頁
          // min-h 60px 確保 iOS Safari 字級縮小時仍維持 Apple HIG 44px 觸控目標
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative flex min-h-[60px] flex-col items-center justify-center gap-1 py-2.5 text-xs transition-colors ${
                active
                  ? "bg-[#FAF7F2] text-accent"
                  : "text-muted-foreground hover:text-foreground active:bg-[#F5F1EC]"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-0.5 bg-accent"
                />
              )}
              <Icon name={tab.icon} />
              <span className="font-medium leading-tight">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function isTabActive(pathname: string, href: string): boolean {
  if (href === pathname) return true;
  // /xxx/new 的 tab 只有完全相符才 active(避免 /xxx 誤觸發 /xxx/new tab)
  if (href.endsWith("/new")) return false;
  // 其他 tab 在 sub-route 也 active(/logs/abc 仍命中 /logs)
  return pathname.startsWith(href + "/");
}

function Icon({ name }: { name: IconName }) {
  const props = {
    width: 26,
    height: 26,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "list":
      return (
        <svg {...props} aria-hidden>
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      );
    case "plus":
      return (
        <svg {...props} aria-hidden strokeWidth={2.5}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      );
    case "check":
      return (
        <svg {...props} aria-hidden>
          <path d="M9 12l2 2 4-4" />
          <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c2.5 0 4.76 1.02 6.39 2.66" />
        </svg>
      );
    case "folder":
      return (
        <svg {...props} aria-hidden>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      );
    case "camera":
      return (
        <svg {...props} aria-hidden>
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      );
    case "users":
      return (
        <svg {...props} aria-hidden>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "file":
      return (
        <svg {...props} aria-hidden>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    case "clock":
      return (
        <svg {...props} aria-hidden>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case "home":
      return (
        <svg {...props} aria-hidden>
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-4a1 1 0 0 1-1-1v-6h-4v6a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2z" />
        </svg>
      );
  }
}
