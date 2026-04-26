import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { DailyLog } from "@/lib/types";

type LogRow = DailyLog & {
  cases: { name: string; code: string | null } | null;
  profiles: { full_name: string } | null;
};

export default async function ApprovalsPage() {
  const supabase = await createClient();
  const { data: pending } = await supabase
    .from("daily_logs")
    .select("*, cases(name, code), profiles!daily_logs_supervisor_id_fkey(full_name)")
    .eq("status", "submitted")
    .order("submitted_at", { ascending: true });

  const list = (pending ?? []) as LogRow[];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-primary md:text-3xl">待簽核</h1>
        <p className="mt-1.5 text-base text-muted-foreground">
          工地主任送出的施工日誌,等你核定
        </p>
      </div>

      {!list.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-20 text-center">
          <div className="mb-3 text-5xl text-[#E0DCD6]">✓</div>
          <p className="text-base text-foreground">沒有待簽核的日誌</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            工地主任送出後會出現在這裡
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {list.map((l) => (
            <Link
              key={l.id}
              href={`/approvals/${l.id}`}
              className="block rounded-lg border border-[#E0DCD6] bg-card p-5 transition-colors hover:border-accent md:p-6"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm text-muted-foreground">
                    {l.cases?.code ?? "未編號"}
                  </div>
                  <h3 className="text-lg font-semibold text-primary md:text-xl">
                    {l.cases?.name ?? "(已刪除案件)"}
                  </h3>
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  <div>{new Date(l.log_date).toLocaleDateString("zh-TW")}</div>
                  <div>{l.profiles?.full_name ?? "未知主任"}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
                <span>{l.work_items?.length ?? 0} 個工項</span>
                <span>{l.photos?.length ?? 0} 張照片</span>
                {l.weather && <span>{l.weather}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
