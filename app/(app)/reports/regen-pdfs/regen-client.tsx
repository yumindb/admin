"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDateTW } from "@/lib/datetime";
import { listRegenTargetsAction, regenerateOnePdfAction } from "./actions";

/**
 * PDF 批次重產 — 一次一份逐筆打 server action(serverless 時限 + 進度條),
 * 單筆失敗記下來繼續跑,最後列失敗清單可單獨重試。
 */

type Target = { id: string; logDate: string; caseName: string };
type Failure = Target & { reason: string };

export function RegenPdfsClient() {
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [current, setCurrent] = useState<Target | null>(null);
  // 「停止」用 ref:running 迴圈是 async,state 讀到的是舊 closure
  const stopRef = useRef(false);

  async function run(missingPdfOnly = false) {
    setPhase("running");
    stopRef.current = false;
    setDone(0);
    setFailures([]);

    const list = await listRegenTargetsAction({ missingPdfOnly });
    if (!list.ok) {
      toast.error(list.error);
      setPhase("idle");
      return;
    }
    if (list.targets.length === 0) {
      toast.info(
        missingPdfOnly
          ? "每份已核定日誌都有 PDF 了，不用補"
          : "沒有已核定的日誌，不用重產",
      );
      setPhase("idle");
      return;
    }
    setTotal(list.targets.length);

    const failed: Failure[] = [];
    let completed = 0;
    for (const t of list.targets) {
      if (stopRef.current) break;
      setCurrent(t);
      try {
        const res = await regenerateOnePdfAction(t.id);
        if (!res.ok) failed.push({ ...t, reason: res.error });
      } catch {
        failed.push({ ...t, reason: "連線失敗或逾時" });
      }
      completed += 1;
      setDone(completed);
      setFailures([...failed]);
    }
    setCurrent(null);
    setPhase("done");
    if (failed.length === 0) {
      toast.success(
        stopRef.current
          ? `已停止 — 完成 ${completed} 份`
          : `全部重產完成（${completed} 份）`,
      );
    } else {
      toast.warning(`完成 ${completed} 份，${failed.length} 份失敗`);
    }
  }

  async function retryOne(f: Failure) {
    const res = await regenerateOnePdfAction(f.id);
    if (res.ok) {
      setFailures((prev) => prev.filter((x) => x.id !== f.id));
      toast.success("重產成功");
    } else {
      toast.error(res.error);
    }
  }

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="rounded-lg border border-[#E0DCD6] bg-card p-5 md:p-6">
      {phase === "idle" && (
        <div>
          <p className="mb-4 text-sm text-muted-foreground">
            按下開始後會逐份重產，過程中請保持這個頁面開著。
            隨時可以停止，已重產的不會白做（重跑會直接覆蓋、可重複執行）。
          </p>
          <div className="flex flex-wrap gap-2">
            {/* 補缺是常見情境(例:2026-08-04 回填成已核定的那批從沒產過 PDF),
                放主按鈕;整批重產留給「改版面要全部重排」那種少見情況。 */}
            <Button
              onClick={() => void run(true)}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              只補「還沒有 PDF」的
            </Button>
            <Button
              variant="outline"
              onClick={() => void run(false)}
              className="border-[#E0DCD6]"
            >
              重產全部已核定 PDF
            </Button>
          </div>
        </div>
      )}

      {phase !== "idle" && (
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-primary">
              {phase === "running" ? "重產中…" : "已完成"}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {done} / {total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#F0EBE4]">
            <div
              className="h-full bg-[#A07850] transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          {current && (
            <p className="mt-2 truncate text-xs text-muted-foreground">
              正在處理：{current.caseName} · {formatDateTW(current.logDate)}
            </p>
          )}

          {phase === "running" && (
            <Button
              variant="outline"
              onClick={() => {
                stopRef.current = true;
              }}
              className="mt-4 border-[#E0DCD6]"
            >
              停止（完成當前這份後停）
            </Button>
          )}

          {failures.length > 0 && (
            <div className="mt-5 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-3">
              <div className="mb-2 text-xs font-medium text-[#B91C1C]">
                {failures.length} 份失敗 — 可單獨重試
              </div>
              <ul className="space-y-1.5">
                {failures.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between gap-2 rounded bg-white px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {f.caseName} · {formatDateTW(f.logDate)}
                      <span className="ml-2 text-xs text-[#B91C1C]">
                        {f.reason}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void retryOne(f)}
                      className="inline-flex h-9 shrink-0 items-center rounded-md border border-[#FCA5A5] bg-white px-3 text-xs font-medium text-[#B91C1C] hover:bg-[#FEE2E2]"
                    >
                      重試
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {phase === "done" && (
            <Button
              variant="outline"
              onClick={() => setPhase("idle")}
              className="mt-4 border-[#E0DCD6]"
            >
              回到開始
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
