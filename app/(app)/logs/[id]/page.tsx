import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ExtraItemsTable } from "@/components/extra-items-table";
import { deleteLogAction } from "../new/actions";
import type { DailyLog, LogApproval } from "@/lib/types";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]" },
  submitted: { label: "待核定", cls: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]" },
  approved: { label: "已核定", cls: "bg-[#ECFDF5] text-[#4A7C59] border-[#A7F3D0]" },
  rejected: { label: "已退回", cls: "bg-[#FEF2F2] text-[#B91C1C] border-[#FCA5A5]" },
};

const STAGE_LABEL: Record<string, string> = {
  review: "複核(工地主任)",
  audit: "審核(辦公室助理)",
  approve: "核定(老闆)",
};

type WorkItemRow = {
  id: string;
  name: string;
  unit: string | null;
  tender_code: string | null;
};

export default async function LogDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: log } = await supabase
    .from("daily_logs")
    .select("*, cases(id, name, code)")
    .eq("id", id)
    .maybeSingle();

  if (!log) notFound();
  const l = log as DailyLog & {
    cases: { id: string; name: string; code: string | null } | null;
  };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .maybeSingle();
  const isOwnerOfLog = l.supervisor_id === user!.id;
  const canEdit =
    isOwnerOfLog && (l.status === "draft" || l.status === "rejected");

  const workItemIds = (l.work_items ?? []).map((w) => w.work_item_id);
  const { data: workItems } = workItemIds.length
    ? await supabase
        .from("case_work_items")
        .select("id, name, unit, tender_code")
        .in("id", workItemIds)
    : { data: [] };
  const wiMap = new Map<string, WorkItemRow>();
  for (const w of workItems ?? []) {
    wiMap.set(w.id as string, w as WorkItemRow);
  }

  const { data: approvals } = await supabase
    .from("log_approvals")
    .select("*")
    .eq("log_id", id)
    .order("created_at", { ascending: true });
  const apList = (approvals ?? []) as LogApproval[];

  const s = STATUS[l.status] ?? STATUS.draft;

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-3 text-xs text-muted-foreground">
        <Link href="/logs" className="hover:text-accent">
          日誌
        </Link>
        <span className="mx-1.5">／</span>
        <span>
          {l.cases?.name ?? "(已刪除)"} ·{" "}
          {new Date(l.log_date).toLocaleDateString("zh-TW")}
        </span>
      </nav>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <span
            className={`inline-block rounded-full border px-2 py-0.5 text-xs ${s.cls}`}
          >
            {s.label}
          </span>
          <h1 className="mt-2 text-xl font-semibold text-primary">
            {new Date(l.log_date).toLocaleDateString("zh-TW")} ·{" "}
            {l.cases?.name}
          </h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {l.weather && <span>天氣:{l.weather}</span>}
            {l.manpower?.own !== undefined && (
              <span>自有 {l.manpower.own} 人</span>
            )}
            {l.manpower?.contract !== undefined && (
              <span>統包 {l.manpower.contract} 人</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Button
              asChild
              variant="outline"
              className="border-[#E0DCD6]"
            >
              <Link href={`/logs/${id}/edit`}>編輯</Link>
            </Button>
          )}
          {canEdit && l.status === "draft" && (
            <form action={deleteLogAction}>
              <input type="hidden" name="logId" value={id} />
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-md border border-[#E0DCD6] bg-white px-3 text-sm text-[#B91C1C] hover:bg-[#FEF2F2]"
              >
                刪除草稿
              </button>
            </form>
          )}
          {profile?.role === "owner" && l.status === "submitted" && (
            <Button
              asChild
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Link href={`/approvals/${id}`}>前往簽核</Link>
            </Button>
          )}
        </div>
      </div>

      {/* 工項 */}
      <Section title={`工項 (${l.work_items?.length ?? 0})`}>
        {!l.work_items?.length ? (
          <p className="text-sm text-muted-foreground">未填工項</p>
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
                    當日完成
                  </th>
                  <th className="h-11 px-3 text-left text-xs font-medium tracking-wider">
                    備註
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
                      <td className="h-12 px-3 align-top">
                        {wi?.name ?? "(已刪除工項)"}
                      </td>
                      <td className="h-12 px-3 align-top text-right tabular-nums">
                        {formatLogQty(w.qty, w.qty_mode, wi?.unit ?? null)}
                      </td>
                      <td className="h-12 px-3 align-top text-xs text-muted-foreground">
                        {w.note ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 合約外項目 */}
      {l.extra_items?.length > 0 && (
        <Section title={`合約外項目 (${l.extra_items.length})`}>
          <ExtraItemsTable
            rows={l.extra_items}
            cols={[
              { key: "name", label: "施工項目" },
              { key: "unit", label: "單位" },
              { key: "qty", label: "數量", align: "right" },
              { key: "headcount", label: "人數", align: "right" },
              { key: "location", label: "位置" },
              { key: "requested_by", label: "甲方交辦" },
              { key: "reason", label: "事由" },
            ]}
          />
        </Section>
      )}

      {/* 未簽約項目 */}
      {l.unsigned_items?.length > 0 && (
        <Section title={`未簽約項目 (${l.unsigned_items.length})`}>
          <ExtraItemsTable
            rows={l.unsigned_items}
            cols={[
              { key: "name", label: "施工項目" },
              { key: "unit", label: "單位" },
              { key: "qty", label: "數量", align: "right" },
              { key: "headcount", label: "人數", align: "right" },
              { key: "category", label: "類別" },
              { key: "quote_amount", label: "報價金額", align: "right" },
              { key: "reason", label: "事由" },
            ]}
          />
        </Section>
      )}

      {/* 照片 */}
      <Section title={`照片 (${l.photos?.length ?? 0})`}>
        {!l.photos?.length ? (
          <p className="text-sm text-muted-foreground">沒有照片</p>
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

      {/* 備註 */}
      {l.notes && (
        <Section title="備註">
          <p className="whitespace-pre-line text-sm">{l.notes}</p>
        </Section>
      )}

      {/* 簽核歷程 */}
      <Section title="簽核歷程">
        {!apList.length ? (
          <p className="text-sm text-muted-foreground">尚未送出</p>
        ) : (
          <ul className="space-y-2">
            {apList.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-[#E0DCD6] bg-card px-3 py-2 text-sm"
              >
                <span className="font-medium text-primary">
                  {STAGE_LABEL[a.stage] ?? a.stage}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    a.decision === "approved"
                      ? "border-[#A7F3D0] bg-[#ECFDF5] text-[#4A7C59]"
                      : "border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]"
                  }`}
                >
                  {a.decision === "approved" ? "通過" : "退回"}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(a.created_at).toLocaleString("zh-TW")}
                </span>
                {a.comment && (
                  <p className="basis-full text-xs text-muted-foreground">
                    {a.comment}
                  </p>
                )}
                {a.signature_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.signature_url}
                    alt="簽名"
                    className="basis-full rounded-md border border-[#E0DCD6] bg-white p-2 max-h-24 object-contain"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
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

function formatLogQty(
  qty: number,
  mode: "absolute" | "percent" | undefined,
  unit: string | null
): string {
  if (mode === "percent") {
    const pct = Math.round(qty * 100);
    return unit ? `${pct}% (${unit})` : `${pct}%`;
  }
  return `${qty}${unit ? " " + unit : ""}`;
}
