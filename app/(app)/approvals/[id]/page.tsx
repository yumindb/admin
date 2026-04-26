import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ApprovalActions } from "./approval-actions";
import { ExtraItemsTable } from "@/components/extra-items-table";
import { NextStepHint } from "@/components/next-step-hint";
import {
  buildReportNumber,
  formatWeatherSummary,
  getRemainingDays,
  getWeekdayLabel,
} from "@/lib/daily-log";
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: roleProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .maybeSingle();
  if (roleProfile?.role !== "owner") redirect("/logs");

  const { data: log } = await supabase
    .from("daily_logs")
    .select(
      "*, cases(id, name, code, company, expected_end), profiles!daily_logs_supervisor_id_fkey(full_name)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!log) notFound();
  const l = log as DailyLog & {
    cases: {
      id: string;
      name: string;
      code: string | null;
      company: string;
      expected_end: string | null;
    } | null;
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
  const remainingDays = getRemainingDays(l.cases?.expected_end, l.log_date);

  return (
    <div className="mx-auto max-w-5xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/approvals" className="hover:text-accent">
          待簽核
        </Link>
        <span className="mx-1.5">／</span>
        <span>
          {l.cases?.name} · {new Date(l.log_date).toLocaleDateString("zh-TW")}
        </span>
      </nav>

      <div className="mb-7">
        <div className="text-sm text-muted-foreground">{l.cases?.code ?? "未編號"}</div>
        <h1 className="mt-1.5 text-2xl font-semibold text-primary md:text-3xl">
          {l.cases?.name}
        </h1>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-base text-muted-foreground">
          <span>日期:{new Date(l.log_date).toLocaleDateString("zh-TW")}</span>
          <span>{getWeekdayLabel(l.log_date)}</span>
          <span>表報編號:{buildReportNumber(l.id, l.log_date)}</span>
          <span>工地主任:{l.profiles?.full_name ?? "—"}</span>
          <span>天氣:{formatWeatherSummary(l.weather)}</span>
        </div>
      </div>

      <Section title="表頭摘要">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <InfoCard label="工程名稱" value={l.cases?.name ?? "—"} />
          <InfoCard label="承攬廠商名稱" value={l.cases?.company ?? "—"} />
          <InfoCard label="預定完工日期" value={l.cases?.expected_end ?? "—"} />
          <InfoCard
            label="剩餘工期"
            value={remainingDays === null ? "—" : `${remainingDays} 天`}
          />
        </div>
      </Section>

      <Section title={`一、依施工計畫書執行按圖施工概況 (${l.work_items?.length ?? 0})`}>
        {!l.work_items?.length ? (
          <p className="text-sm text-muted-foreground">無</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[#E0DCD6] bg-card">
            <table className="min-w-full text-base">
              <thead>
                <tr className="bg-primary text-primary-foreground">
                  <th className="h-12 px-4 text-left text-sm font-medium tracking-wider">
                    項次
                  </th>
                  <th className="h-12 px-4 text-left text-sm font-medium tracking-wider">
                    工項
                  </th>
                  <th className="h-12 px-4 text-right text-sm font-medium tracking-wider">
                    完成
                  </th>
                </tr>
              </thead>
              <tbody>
                {l.work_items.map((w) => {
                  const wi = wiMap.get(w.work_item_id);
                  const display =
                    w.qty_mode === "percent"
                      ? `${Math.round(w.qty * 100)}%${
                          wi?.unit ? ` (${wi.unit})` : ""
                        }`
                      : `${w.qty}${wi?.unit ? " " + wi.unit : ""}`;
                  return (
                    <tr key={w.work_item_id} className="border-b border-[#E0DCD6]">
                      <td className="h-14 px-4 align-top font-mono text-sm text-muted-foreground">
                        {wi?.tender_code ?? "—"}
                      </td>
                      <td className="h-14 px-4 align-top">{wi?.name ?? "—"}</td>
                      <td className="h-14 px-4 align-top text-right tabular-nums">
                        {display}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="二、外包人員及機具管理">
        <div className="space-y-5">
          <ExtraItemsTable
            rows={l.manpower?.subcontractors ?? []}
            cols={[
              { key: "trade", label: "工別" },
              { key: "today", label: "本日人數", align: "right" },
              { key: "accumulated", label: "累計人數", align: "right" },
            ]}
          />
          <ExtraItemsTable
            rows={l.manpower?.machines ?? []}
            cols={[
              { key: "name", label: "機具名稱" },
              { key: "today", label: "本日使用數量", align: "right" },
              { key: "accumulated", label: "累計使用數量", align: "right" },
            ]}
          />
        </div>
      </Section>

      {l.vendor_notices && (
        <Section title="三、通知協力廠商辦理事項">
          <p className="whitespace-pre-line text-sm">{l.vendor_notices}</p>
        </Section>
      )}

      {l.extra_items?.length > 0 && (
        <Section title={`四、非合約內施工項目 (${l.extra_items.length})`}>
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

      {l.unsigned_items?.length > 0 && (
        <Section title={`五、未簽約施工內容 (${l.unsigned_items.length})`}>
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
        <Section title="六、重要事項紀錄">
          <p className="whitespace-pre-line text-sm">{l.notes}</p>
        </Section>
      )}

      {/* 簽核 */}
      <div className="mb-4">
        <NextStepHint tone="info">
          確認上方內容後,在下方簽名按「核定通過」,系統自動跳下一份。要退回切到「退回」分頁。
        </NextStepHint>
      </div>
      <ApprovalActions logId={id} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-3 text-base font-semibold text-primary md:text-lg">{title}</h2>
      {children}
    </section>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#E0DCD6] bg-white px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium text-primary">{value}</div>
    </div>
  );
}
