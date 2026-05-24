import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-start gap-5 rounded-md border border-[#E0DCD6] bg-white p-6 md:p-8">
      <div className="flex flex-col gap-2">
        <p className="text-sm tracking-widest text-[#A07850]">NOT FOUND</p>
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">找不到這個頁面</h1>
        <p className="text-base text-[#5A5050]">
          您要造訪的頁面不存在，可能網址打錯，或這份資料已經被刪除。
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/">回首頁</Link>
        </Button>
      </div>
    </div>
  );
}
