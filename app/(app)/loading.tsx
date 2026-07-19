import { SkeletonBar, SkeletonCard, SkeletonPage } from "@/components/ui/skeleton";

/**
 * (app) 全段共用的載入骨架 — 子路由沒有自己的 loading.tsx 時用這個。
 * (為什麼需要骨架:見 components/ui/skeleton.tsx)
 */
export default function Loading() {
  return (
    <SkeletonPage>
      <div className="mb-6 space-y-2">
        <SkeletonBar tone="mid" className="h-4 w-24" />
        <SkeletonBar className="h-8 w-56" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} className="h-24">
            <SkeletonBar tone="mid" className="h-5 w-1/3" />
            <SkeletonBar tone="soft" className="mt-3 h-4 w-2/3" />
          </SkeletonCard>
        ))}
      </div>
    </SkeletonPage>
  );
}
