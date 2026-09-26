"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";

export type DesktopLink = {
  href: string;
  label: string;
  badge?: number;
  /**
   * primary(預設):永遠直接放在列上。
   * secondary:寬螢幕(2xl,≥1536px)直接放;窄一點收進「更多 ▾」。
   * 有 group 的:一律收在該群組的下拉(例如「人事 ▾」= 人員管理 / 排班 / 薪資)。
   */
  tier?: "primary" | "secondary";
  group?: string;
};

/**
 * 桌機頂部導覽(2026-09-26 改版)。
 *
 * 為什麼:助理 / 老闆的項目到 11–12 個,原本一排不換行,1280 的筆電就被右側帳號區擠爆。
 * 做法:純 CSS 斷點,不量寬度 —
 *   - primary 直接放
 *   - group 收成下拉(人事 ▾)
 *   - secondary 在 2xl 才直接放,其餘寬度收進「更多 ▾」
 * 下拉是自己寫的小元件(click-outside + Esc),沒有多裝套件。
 */
export function DesktopNav({ links }: { links: DesktopLink[] }) {
  const pathname = usePathname() ?? "";
  const primary = links.filter((l) => !l.group && (l.tier ?? "primary") === "primary");
  const secondary = links.filter((l) => !l.group && l.tier === "secondary");
  const groups = new Map<string, DesktopLink[]>();
  for (const l of links) {
    if (!l.group) continue;
    const list = groups.get(l.group);
    if (list) list.push(l);
    else groups.set(l.group, [l]);
  }

  return (
    <nav className="hidden items-center gap-4 text-sm text-[#E8E4DE] md:flex lg:gap-5 lg:text-base">
      {primary.map((l) => (
        <NavLink key={l.href} link={l} active={isActive(pathname, l.href)} />
      ))}
      {Array.from(groups.entries()).map(([label, items]) => (
        <Dropdown
          key={label}
          label={label}
          items={items}
          pathname={pathname}
          badge={items.reduce((s, i) => s + (i.badge ?? 0), 0)}
          activeInside={items.some((i) => isActive(pathname, i.href))}
        />
      ))}
      {/* secondary:2xl 直接放(包一層,避免 hidden 與 inline-flex 打架);其餘寬度收進「更多 ▾」 */}
      {secondary.length > 0 && (
        <div className="hidden items-center gap-4 lg:gap-5 2xl:flex">
          {secondary.map((l) => (
            <NavLink key={l.href} link={l} active={isActive(pathname, l.href)} />
          ))}
        </div>
      )}
      {secondary.length > 0 && (
        <Dropdown
          label="更多"
          items={secondary}
          pathname={pathname}
          badge={secondary.reduce((s, i) => s + (i.badge ?? 0), 0)}
          activeInside={secondary.some((i) => isActive(pathname, i.href))}
          className="2xl:hidden"
        />
      )}
    </nav>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function Badge({ n }: { n?: number }) {
  if (!n || n <= 0) return null;
  return (
    <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-[#B91C1C] px-1.5 py-0 text-xs font-semibold tabular-nums leading-5 text-white">
      {n}
    </span>
  );
}

function NavLink({
  link,
  active,
  className = "",
}: {
  link: DesktopLink;
  active: boolean;
  className?: string;
}) {
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 py-1 transition-colors hover:text-white ${
        active ? "border-[#A07850] text-white" : "border-transparent"
      } ${className}`}
    >
      <span>{link.label}</span>
      <Badge n={link.badge} />
    </Link>
  );
}

function Dropdown({
  label,
  items,
  pathname,
  badge,
  activeInside,
  className = "",
}: {
  label: string;
  items: DesktopLink[];
  pathname: string;
  badge: number;
  activeInside: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // 換頁後收起(在 render 期間比對路徑,不用 effect)
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1 whitespace-nowrap border-b-2 py-1 transition-colors hover:text-white ${
          activeInside ? "border-[#A07850] text-white" : "border-transparent"
        }`}
      >
        <span>{label}</span>
        <Badge n={badge} />
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-2 min-w-[10rem] overflow-hidden rounded-md border border-[#E0DCD6] bg-card py-1 text-sm text-foreground shadow-lg"
        >
          {items.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-[#F5F1EC] ${
                  active ? "font-medium text-accent" : ""
                }`}
              >
                <span>{l.label}</span>
                <Badge n={l.badge} />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
