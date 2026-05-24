"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type ErrorKind = "permission" | "auth" | "notfound" | "generic";

function classify(message: string): ErrorKind {
  if (!message) return "generic";
  if (message.includes("權限不足")) return "permission";
  if (message.includes("請先登入") || message.includes("未登入")) return "auth";
  if (message.includes("找不到") || message.includes("not found")) return "notfound";
  return "generic";
}

const COPY: Record<ErrorKind, { title: string; body: string }> = {
  permission: {
    title: "權限不足",
    body: "您的帳號沒有權限執行這個操作。如果您覺得這是誤判，請聯絡系統管理員。",
  },
  auth: {
    title: "請先登入",
    body: "登入狀態已經失效，請重新登入後再操作。",
  },
  notfound: {
    title: "找不到資料",
    body: "您要存取的資料不存在，可能已被刪除或網址有誤。",
  },
  generic: {
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

  const kind = classify(error?.message ?? "");
  const copy = COPY[kind];

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-start gap-5 rounded-md border border-[#E0DCD6] bg-white p-6 md:p-8">
      <div className="flex flex-col gap-2">
        <p className="text-sm tracking-widest text-[#A07850]">{kind === "auth" ? "AUTH" : kind === "permission" ? "FORBIDDEN" : kind === "notfound" ? "NOT FOUND" : "ERROR"}</p>
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">{copy.title}</h1>
        <p className="text-base text-[#5A5050]">{copy.body}</p>
      </div>

      {kind === "generic" && error?.message ? (
        <div className="w-full rounded-md border border-[#E0DCD6] bg-[#F5F1EC] p-3">
          <p className="text-xs text-[#8A847C]">錯誤訊息</p>
          <p className="mt-1 break-all text-sm text-[#5A5050]">{error.message}</p>
          {error.digest ? (
            <>
              <p className="mt-3 text-xs text-[#8A847C]">錯誤代碼（回報時請附上）</p>
              <p className="mt-1 font-mono text-sm text-[#5A5050]">{error.digest}</p>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {kind === "auth" ? (
          <Button asChild>
            <Link href="/login">前往登入</Link>
          </Button>
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
