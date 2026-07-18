/**
 * 簽核詳情的載入骨架 — 這頁要 fetchAllRows 撈全案工項(配電盤案 1100+ 筆)
 * 算漏填清單,是全站最慢的頁之一;簽完「自動跳下一份」的等待也走這裡。
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse" aria-label="載入中" role="status">
      <div className="mb-3 h-4 w-28 rounded bg-[#E0DCD6]/70" />
      <div className="mb-6 h-8 w-64 rounded bg-[#E0DCD6]" />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="mb-4 rounded-lg border border-[#E0DCD6] bg-card p-5"
        >
          <div className="h-5 w-40 rounded bg-[#E0DCD6]/70" />
          <div className="mt-4 space-y-2">
            <div className="h-4 w-full rounded bg-[#F0EBE4]" />
            <div className="h-4 w-5/6 rounded bg-[#F0EBE4]" />
            <div className="h-4 w-2/3 rounded bg-[#F0EBE4]" />
          </div>
        </div>
      ))}
      <p className="mt-2 text-center text-sm text-muted-foreground">
        日誌內容載入中…
      </p>
    </div>
  );
}
