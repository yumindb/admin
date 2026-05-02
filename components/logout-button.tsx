"use client";

import { useFormStatus } from "react-dom";

/**
 * 登出按鈕 — 拆出來才能用 useFormStatus 顯示送出中狀態。
 * 必須放在 <form action={logoutAction}> 底下才能讀到 pending。
 */
export function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-[#A07850]/40 px-3 py-2 text-sm text-[#E8E4DE] transition-colors hover:bg-white/5 disabled:opacity-60"
    >
      {pending ? "登出中…" : "登出"}
    </button>
  );
}
