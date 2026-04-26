import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ApprovalActions } from "./approval-actions";
import type { DailyLog } from "@/lib/types";

type WorkItemRow = {
  id: string;
  name: string;
  unit: string | null;
  tender_code: string | null;
};

export default async function ApprovalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: log } = await supabase
    .from("daily_logs")
    .select(
      "*, cases(id, name, code), profiles!daily_logs_supervisor_id_fkey(full_name)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!log) notFound();
  const l = log as DailyLog & {
    cases: { id: string; name: string; code: string | null } | null;
    profiles: { full_name: string } | null;
  };

  // 已處理過的就跳到 detail 頁
  if (l.status !== "submitted") redirect(`/logs/${id}`);

  const wiIds = (l.work_items ?? []).map((w) => w.work_item_id);
  const { data: workItems } = wiIds.length
    ? await supabase
        .from("case_work_items")
        .select("id, name, unit, tender_code")
        .in("id", wiIds)
    : { data: [] };
  const wiMap = new Map<string, WorkItemRow>();
  for (const w of workItems ?? []) wiMap.set(w.id as string, w as WorkItemRow);

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-3 text-xs text-muted-foreground">
        <Link href="/approvals" className="hover:text-accent">
          待簽核
        </Link>
        <span className="mx-1.5">／</span>
        <span>
          {l.cases?.name} · {new Date(l.log_date).toLocaleDateString("zh-TW")}
        </span>
      </nav>

      <div className="mb-5">
        <div className="text-xs text-muted-foreground">{l.cases?.code ?? "未編號"}</div>
        <h1 className="mt-1 text-xl font-semibold text-primary">
          {l.cases?.name}
        </h1>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>日期:{new Date(l.log_date).toLocaleDateString("zh-TW")}</span>
          <span>工地主任:{l.profiles?.full_name ?? "—"}</span>
          {l.weather && <span>天氣:{l.weather}</span>}
        </div>
      </div>

      {/* 摘要 */}
      <Section title={`工項 (${l.work_items?.length ?? 0})`}>
        {!l.work_items?.length ? (
          <p className="text-sm text-muted-foreground">無</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[#E0DCD6] bg-card">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-primary text-primary-foreground">
                  <th className="h-11 px-3 text-left text-xs font-medium tracking-wider">
                    項次
                  </th>
                  <th className="h-11 px-3 text-left text-xs font-medium tracking-wider">
                    工項
                  </th>
                  <th className="h-11 px-3 text-right text-xs font-medium tracking-wider">
                    完成
                  </th>
                </tr>
              </thead>
              <tbody>
                {l.work_items.map((w) => {
                  const wi = wiMap.get(w.work_item_id);
                  return (
                    <tr key={w.work_item_id} className="border-b border-[#E0DCD6]">
                      <td className="h-12 px-3 align-top font-mono text-xs text-muted-foreground">
                        {wi?.tender_code ?? "—"}
                      </td>
                      <td className="h-12 px-3 align-top">{wi?.name ?? "—"}</td>
                      <td className="h-12 px-3 align-top text-right tabular-nums">
                        {w.qty} {wi?.unit ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`照片 (${l.photos?.length ?? 0})`}>
        {!l.photos?.length ? (
          <p className="text-sm text-muted-foreground">無</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
            {l.photos.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <a key={p} href={p} target="_blank" rel="noreferrer">
                <img
                  src={p}
                  alt=""
                  className="aspect-square w-full rounded-md border border-[#E0DCD6] object-cover"
                />
              </a>
            ))}
          </div>
        )}
      </Section>

      {l.notes && (
        <Section title="備註">
          <p className="whitespace-pre-line text-sm">{l.notes}</p>
        </Section>
      )}

      {/* 簽核 */}
      <ApprovalActions logId={id} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-sm font-medium text-primary">{title}</h2>
      {children}
    </section>
  );
}
