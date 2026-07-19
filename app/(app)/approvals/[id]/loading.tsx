import { SkeletonBar, SkeletonCard, SkeletonPage } from "@/components/ui/skeleton";

/**
 * 簽核詳情的載入骨架 — 這頁要 fetchAllRows 撈全案工項(配電盤案 1100+ 筆)
 * 算漏填清單,是全站最慢的頁之一;簽完「自動跳下一份」的等待也走這裡。
 */
export default function Loading() {
  return (
    <SkeletonPage className="max-w-5xl">
      <SkeletonBar tone="mid" className="mb-3 h-4 w-28" />
      <SkeletonBar className="mb-6 h-8 w-64" />
      {[0, 1, 2].map((i) => (
        <SkeletonCard key={i} className="mb-4 p-5">
          <SkeletonBar tone="mid" className="h-5 w-40" />
          <div className="mt-4 space-y-2">
            <SkeletonBar tone="soft" className="h-4 w-full" />
            <SkeletonBar tone="soft" className="h-4 w-5/6" />
            <SkeletonBar tone="soft" className="h-4 w-2/3" />
          </div>
        </SkeletonCard>
      ))}
      <p className="mt-2 text-center text-sm text-muted-foreground">
        日誌內容載入中…
      </p>
    </SkeletonPage>
  );
}
