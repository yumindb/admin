"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, type LoginState } from "./actions";

// 只記帳號,不記密碼 — 密碼交給瀏覽器的密碼管理員
// (欄位有 autoComplete,手機會自己跳「儲存密碼」)
const REMEMBER_KEY = "yumin-remembered-username";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    undefined
  );
  const usernameRef = useRef<HTMLInputElement>(null);
  const [remember, setRemember] = useState(true);

  // 帶入上次記住的帳號(直接填 DOM,不經 state — 避免 SSR/hydration 值不一致)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved && usernameRef.current && !usernameRef.current.value) {
        usernameRef.current.value = saved;
      }
    } catch {
      // localStorage 不可用(隱私模式等)就當作沒記
    }
  }, []);

  function saveRemembered() {
    try {
      const name = usernameRef.current?.value.trim();
      if (remember && name) {
        localStorage.setItem(REMEMBER_KEY, name);
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }
    } catch {
      // 存不進去不影響登入
    }
  }

  return (
    <form action={formAction} onSubmit={saveRemembered} className="space-y-5">
      <input type="hidden" name="next" value={next} />

      <div className="space-y-2">
        <Label htmlFor="username">帳號</Label>
        <Input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          required
          minLength={2}
          maxLength={30}
          pattern="[a-z0-9]{2,30}"
          placeholder="例：owner"
          ref={usernameRef}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">密碼</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
        />
      </div>

      <label className="flex min-h-11 select-none items-center gap-2.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="h-5 w-5 rounded-sm accent-primary"
        />
        記住帳號，下次打開不用重打
      </label>

      {state?.error && (
        <p className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          {state.error}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
        disabled={pending}
      >
        {pending ? "登入中…" : "登入"}
      </Button>
    </form>
  );
}
