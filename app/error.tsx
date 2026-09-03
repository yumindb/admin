"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  classifyError,
  isRedactedServerMessage,
  type ErrorKind,
} from "@/lib/auth/error-codes";
import { logoutAction } from "./login/actions";

const COPY: Record<ErrorKind, { label: string; title: string; body: string }> = {
  permission: {
    label: "FORBIDDEN",
    title: "權限不足",
    body: "您的帳號沒有權限執行這個操作。如果您覺得這是誤判，請聯絡系統管理員。",
  },
  auth: {
    label: "AUTH",
    title: "請重新登入",
    body: "登入狀態已經失效，請重新登入後再操作。",
  },
  notfound: {
    label: "NOT FOUND",
    title: "找不到資料",
    body: "您要存取的資料不存在，可能已被刪除或網址有誤。",
  },
  transient: {
    label: "RETRY",
    title: "連線暫時出了問題",
    body: "讀取帳號資料時連線失敗，通常按「重試」就會恢復。如果連續發生，把下方錯誤代碼回報給管理員。",
  },
  generic: {
    label: "ERROR",
    title: "發生錯誤",
    body: "系統處理時發生未預期的錯誤。請重新整理頁面再試一次；如果持續發生，把下方錯誤代碼回報給管理員。",
  },
};

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[RouteError]", error);
  }, [error]);

  // production 下 server 端錯誤的 message 會被 React 遮掉,只剩 digest —
  // 分類以 digest 優先(見 lib/auth/error-codes.ts)
  const kind = classifyError(error);
  const copy = COPY[kind];
  const showDetails = kind === "generic" || kind === "transient";
  // React 的英文樣板文對使用者沒有意義,換成一句人話;真正的訊息在 Vercel log 裡
  const message = isRedactedServerMessage(error?.message)
    ? "伺服器端發生錯誤（詳細內容只記錄在系統日誌）"
    : error?.message;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-start gap-5 rounded-md border border-[#E0DCD6] bg-white p-6 md:p-8">
      <div className="flex flex-col gap-2">
        <p className="text-sm tracking-widest text-[#A07850]">{copy.label}</p>
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">{copy.title}</h1>
        <p className="text-base text-[#5A5050]">{copy.body}</p>
      </div>

      {showDetails && (message || error?.digest) ? (
        <div className="w-full rounded-md border border-[#E0DCD6] bg-[#F5F1EC] p-3">
          {message ? (
            <>
              <p className="text-xs text-[#8A847C]">錯誤訊息</p>
              <p className="mt-1 break-all text-sm text-[#5A5050]">{message}</p>
            </>
          ) : null}
          {error?.digest ? (
            <>
              <p className={message ? "mt-3 text-xs text-[#8A847C]" : "text-xs text-[#8A847C]"}>
                錯誤代碼（回報時請附上）
              </p>
              <p className="mt-1 font-mono text-sm text-[#5A5050]">{error.digest}</p>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {kind === "auth" ? (
          // 走登出再導向,不能只連到 /login:session cookie 可能還在(例如有 auth user
          // 但沒 profile),middleware 會把「已登入」的人從 /login 彈回首頁,變成迴圈。
          <form action={logoutAction}>
            <Button type="submit">重新登入</Button>
          </form>
        ) : (
          <Button onClick={() => reset()}>重試</Button>
        )}
        <Button asChild variant="outline">
          <Link href="/">回首頁</Link>
        </Button>
      </div>
    </div>
  );
}
