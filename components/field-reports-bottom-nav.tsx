"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 給現場工人 (field_assistant) 用的底部 app-style tab bar。
 * 兩個大按鈕,連桌機都用一樣 — 跟現場工人在實際手機操作體驗一致。
 */
export function FieldReportsBottomNav() {
  const pathname = usePathname() ?? "";
  const isNew = pathname === "/field-reports/new";
  const isList = pathname === "/field-reports" || pathname.startsWith("/field-reports/") && !isNew;

  return (
    <nav
      aria-label="現場回報導覽"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E0DCD6] bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(0,0,0,0.04)]"
    >
      <div className="grid grid-cols-2">
        <Tab href="/field-reports" active={isList} icon={<ListIcon />} label="我的回報" />
        <Tab href="/field-reports/new" active={isNew} icon={<PlusIcon />} label="新增回報" />
      </div>
    </nav>
  );
}

function Tab({
  href,
  active,
  icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={`flex flex-col items-center justify-center gap-1 py-3 text-base transition-colors ${
        active
          ? "text-accent"
          : "text-muted-foreground hover:text-foreground active:bg-[#F5F1EC]"
      }`}
      aria-current={active ? "page" : undefined}
    >
      <span aria-hidden className="text-2xl leading-none">
        {icon}
      </span>
      <span className="font-medium">{label}</span>
    </Link>
  );
}

function ListIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}
