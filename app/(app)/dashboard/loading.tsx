import { SkeletonBar, SkeletonCard, SkeletonPage } from "@/components/ui/skeleton";

/** Dashboard 載入骨架 — 這頁串 8+ 個 query,是全站最慢的頁之一。 */
export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonBar className="mb-6 h-8 w-48" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} className="h-28">
            <SkeletonBar tone="mid" className="h-4 w-16" />
            <SkeletonBar tone="soft" className="mt-3 h-8 w-12" />
          </SkeletonCard>
        ))}
      </div>
      <div className="mt-6 space-y-3">
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} className="h-32">
            <SkeletonBar tone="mid" className="h-5 w-1/4" />
            <SkeletonBar tone="soft" className="mt-3 h-4 w-3/4" />
            <SkeletonBar tone="soft" className="mt-2 h-4 w-1/2" />
          </SkeletonCard>
        ))}
      </div>
    </SkeletonPage>
  );
}
