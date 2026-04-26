import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import type { DailyLog } from "@/lib/types";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]" },
  submitted: { label: "待核定", cls: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]" },
  approved: { label: "已核定", cls: "bg-[#ECFDF5] text-[#4A7C59] border-[#A7F3D0]" },
  rejected: { label: "已退回", cls: "bg-[#FEF2F2] text-[#B91C1C] border-[#FCA5A5]" },
};

type LogRow = DailyLog & { cases: { name: string; code: string | null } | null };

export default async function LogsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // supervisor 只看自己;office_staff/owner 看全部 (POC RLS allow all but UX 上 supervisor 只想看自己)
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .maybeSingle();

  let query = supabase
    .from("daily_logs")
    .select("*, cases(name, code)")
    .order("log_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (profile?.role === "site_supervisor") {
    query = query.eq("supervisor_id", user!.id);
  }

  const { data: logs, error } = await query;
  const list = (logs ?? []) as LogRow[];

  const isSupervisor = profile?.role === "site_supervisor";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-primary">
            {isSupervisor ? "我的日誌" : "施工日誌"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSupervisor ? "你建的施工日誌" : "全部施工日誌"}
          </p>
        </div>
        {isSupervisor && (
          <Button
            asChild
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Link href="/logs/new">+ 新日誌</Link>
          </Button>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          載入失敗:{error.message}
        </p>
      )}

      {!list.length ? (
        <Empty isSupervisor={isSupervisor} />
      ) : (
        <div className="space-y-3">
          {list.map((l) => {
            const s = STATUS[l.status] ?? STATUS.draft;
            return (
              <Link
                key={l.id}
                href={`/logs/${l.id}`}
                className="block rounded-md border border-[#E0DCD6] bg-card p-4 transition-colors hover:border-accent"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="text-sm text-muted-foreground">
                    {new Date(l.log_date).toLocaleDateString("zh-TW")}
                    {l.weather && (
                      <span className="ml-2 text-xs">· {l.weather}</span>
                    )}
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${s.cls}`}
                  >
                    {s.label}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-primary">
                  {l.cases?.name ?? "(已刪除案件)"}
                </h3>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{l.work_items?.length ?? 0} 個工項</span>
                  <span>{l.photos?.length ?? 0} 張照片</span>
                  {l.notes && <span className="line-clamp-1">📝 {l.notes}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Empty({ isSupervisor }: { isSupervisor: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-[#E0DCD6] bg-card px-6 py-16 text-center">
      <div className="mb-3 text-4xl text-[#E0DCD6]">📋</div>
      <p className="mb-1 text-sm text-foreground">
        {isSupervisor ? "你還沒建任何日誌" : "目前還沒有任何日誌"}
      </p>
      <p className="mb-5 text-xs text-muted-foreground">
        {isSupervisor
          ? "選一個案件開新日誌,填工項數量、加照片、送出給老闆核定"
          : "工地主任送出日誌後會出現在這裡"}
      </p>
      {isSupervisor && (
        <Button
          asChild
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Link href="/logs/new">建第一份日誌</Link>
        </Button>
      )}
    </div>
  );
}
