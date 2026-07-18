/**
 * (app) 全段共用的載入骨架 — 子路由沒有自己的 loading.tsx 時用這個。
 *
 * 為什麼需要:App Router 沒有 loading boundary 時,點連結後畫面會停在
 * 原頁完全不動,慢網路 2-5 秒像當機。RouteProgress 的頂部光條只有 3px,
 * 大頁面(案件列表全案 stats、報表)值得給整頁的視覺回饋。
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse" aria-label="載入中" role="status">
      <div className="mb-6 space-y-2">
        <div className="h-4 w-24 rounded bg-[#E0DCD6]/70" />
        <div className="h-8 w-56 rounded bg-[#E0DCD6]" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 rounded-lg border border-[#E0DCD6] bg-card p-4"
          >
            <div className="h-5 w-1/3 rounded bg-[#E0DCD6]/70" />
            <div className="mt-3 h-4 w-2/3 rounded bg-[#F0EBE4]" />
          </div>
        ))}
      </div>
    </div>
  );
}
