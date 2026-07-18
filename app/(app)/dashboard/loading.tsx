/** Dashboard 載入骨架 — 這頁串 8+ 個 query,是全站最慢的頁之一。 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse" aria-label="載入中" role="status">
      <div className="mb-6 h-8 w-48 rounded bg-[#E0DCD6]" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 rounded-lg border border-[#E0DCD6] bg-card p-4"
          >
            <div className="h-4 w-16 rounded bg-[#E0DCD6]/70" />
            <div className="mt-3 h-8 w-12 rounded bg-[#F0EBE4]" />
          </div>
        ))}
      </div>
      <div className="mt-6 space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-32 rounded-lg border border-[#E0DCD6] bg-card p-4"
          >
            <div className="h-5 w-1/4 rounded bg-[#E0DCD6]/70" />
            <div className="mt-3 h-4 w-3/4 rounded bg-[#F0EBE4]" />
            <div className="mt-2 h-4 w-1/2 rounded bg-[#F0EBE4]" />
          </div>
        ))}
      </div>
    </div>
  );
}
