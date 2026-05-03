import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTW } from "@/lib/datetime";
import { ApprovalActions } from "./approval-actions";
import { ExtraItemsTable } from "@/components/extra-items-table";
import { NextStepHint } from "@/components/next-step-hint";
import {
  buildReportNumber,
  formatWeatherSummary,
  getRemainingDays,
  getWeekdayLabel,
  isBackfilledLog,
  normalizeLogPhotos,
} from "@/lib/daily-log";
import {
  fetchWorkItemAncestry,
  groupWorkItemsByAncestor,
} from "@/lib/work-item-grouping";
import { getSignedUrls } from "@/lib/supabase/storage";
import type { ApprovalStage, DailyLog, UserRole } from "@/lib/types";
import type { WorkItemGroup } from "@/lib/work-item-grouping";
import type { DailyLogWorkItem } from "@/lib/types";

const STAGE_FOR_ROLE: Record<UserRole, ApprovalStage | null> = {
  site_supervisor: "review",
  office_staff: "audit",
  owner: "approve",
  field_assistant: null,
};

const STAGE_COPY: Record<ApprovalStage, { title: string; verb: string }> = {
  fill: { title: "填寫", verb: "送出" },
  review: { title: "複核", verb: "複核通過" },
  audit: { title: "審核", verb: "審核通過" },
  approve: { title: "核定", verb: "核定通過" },
};

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
  const role = (roleProfile?.role ?? null) as UserRole | null;
  const allowedStage = role ? STAGE_FOR_ROLE[role] : null;
  if (!allowedStage) redirect("/logs");

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

  // 已處理過或當前不在我的關卡 → 回 detail / 列表
  if (l.status !== "submitted") redirect(`/logs/${id}`);
  if (l.current_stage !== allowedStage) redirect(`/logs/${id}`);
  // supervisor 只能複核自己的日誌
  if (role === "site_supervisor" && l.supervisor_id !== user!.id) {
    redirect("/approvals");
  }
  const stageCopy = STAGE_COPY[allowedStage];

  // 表報編號需要該案件當日序號 — 算 created_at <= 自己的同日同案 row 數
  const { count: dayCount } = await supabase
    .from("daily_logs")
    .select("id", { count: "exact", head: true })
    .eq("case_id", l.case_id)
    .eq("log_date", l.log_date)
    .lte("created_at", l.created_at);
  const daySeq = dayCount ?? 1;

  const wiIds = (l.work_items ?? []).map((w) => w.work_item_id);
  const ancestry = await fetchWorkItemAncestry(supabase, wiIds);
  const wiMap = new Map<string, WorkItemRow>();
  for (const [id, n] of ancestry) {
    wiMap.set(id, { id, name: n.name, unit: n.unit, tender_code: n.tender_code });
  }
  // 拆三組(同 logs/[id]/page.tsx)
  const contractWorkItems: DailyLogWorkItem[] = [];
  const extraWorkItems: DailyLogWorkItem[] = [];
  const unsignedWorkItems: DailyLogWorkItem[] = [];
  for (const w of l.work_items ?? []) {
    const t = ancestry.get(w.work_item_id)?.item_type;
    if (t === "extra") extraWorkItems.push(w);
    else if (t === "unsigned") unsignedWorkItems.push(w);
    else contractWorkItems.push(w);
  }
  const workItemGroups = groupWorkItemsByAncestor(
    contractWorkItems,
    (w) => w.work_item_id,
    ancestry
  );
  const remainingDays = getRemainingDays(l.cases?.expected_end, l.log_date);
  const rawLogPhotos = normalizeLogPhotos(l.photos);
  const photoSignedMap = await getSignedUrls(
    "daily-photos",
    rawLogPhotos.map((p) => p.path)
  );
  const logPhotos = rawLogPhotos.map((p) => ({
    ...p,
    path: photoSignedMap.get(p.path) ?? p.path,
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/approvals" className="hover:text-accent">
          待{stageCopy.title}
        </Link>
        <span className="mx-1.5">／</span>
        <span>
          {l.cases?.name} · {formatDateTW(l.log_date)}
        </span>
      </nav>

      <div className="mb-7">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{l.cases?.code ?? "未編號"} · {stageCopy.title}階段</span>
          {isBackfilledLog(l) && (
            <span
              className="rounded-full border border-[#FDBA74] bg-[#FFF7ED] px-2 py-0.5 text-xs text-[#C2410C]"
              title="此日誌的施工日期跟實際填寫日期不同(隔天以上補填)"
            >
              補件
            </span>
          )}
        </div>
        <h1 className="mt-1.5 text-2xl font-semibold text-primary md:text-3xl">
          {l.cases?.name}
        </h1>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-base text-muted-foreground">
          <span>日期:{formatDateTW(l.log_date)}</span>
          <span>{getWeekdayLabel(l.log_date)}</span>
          <span>
            表報編號:
            {buildReportNumber({
              caseCode: l.cases?.code ?? null,
              logDate: l.log_date,
              daySeq,
            })}
          </span>
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

      <Section title={`一、依施工計畫書執行按圖施工概況 (${contractWorkItems.length})`}>
        {!contractWorkItems.length ? (
          <p className="text-sm text-muted-foreground">無合約內工項</p>
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
                {workItemGroups.map((g, gi) => (
                  <GroupRows
                    key={g.groupId ?? `orphan-${gi}`}
                    group={g}
                    wiMap={wiMap}
                    cols={3}
                  />
                ))}
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

      {extraWorkItems.length > 0 && (
        <Section title={`四、合約外項目 (${extraWorkItems.length})`}>
          <ApprovalExtraUnsignedTable rows={extraWorkItems} wiMap={wiMap} />
        </Section>
      )}

      {unsignedWorkItems.length > 0 && (
        <Section title={`五、未簽約施工內容 (${unsignedWorkItems.length})`}>
          <ApprovalExtraUnsignedTable rows={unsignedWorkItems} wiMap={wiMap} />
        </Section>
      )}

      {/* 舊資料相容 */}
      {l.extra_items?.length > 0 && (
        <Section title={`（舊）合約外（free-form） (${l.extra_items.length})`}>
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
        <Section title={`（舊）未簽約（free-form） (${l.unsigned_items.length})`}>
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

      <Section title={`照片 (${logPhotos.length})`}>
        {!logPhotos.length ? (
          <p className="text-sm text-muted-foreground">無</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {logPhotos.map((p, i) => (
              <figure
                key={`${p.path}-${i}`}
                className="overflow-hidden rounded-md border border-[#E0DCD6] bg-white"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <a href={p.path} target="_blank" rel="noreferrer">
                  <img
                    src={p.path}
                    alt={p.caption || ""}
                    className="aspect-square w-full object-cover"
                  />
                </a>
                {p.caption && (
                  <figcaption className="border-t border-[#F0EBE4] bg-[#FAF7F2] px-2 py-1.5 text-xs text-foreground">
                    {p.caption}
                  </figcaption>
                )}
              </figure>
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
          {allowedStage === "approve"
            ? "確認上方內容後,在下方簽名按「核定通過」,系統自動跳下一份。要退回切到「退回」分頁。"
            : `確認上方內容後在下方簽名按「${stageCopy.verb}」,系統會把日誌推到下一關。要退回切到「退回」分頁,主任會在「我的日誌」看到並可修正後重送。`}
        </NextStepHint>
      </div>
      <ApprovalActions logId={id} stage={allowedStage} />
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

function GroupRows({
  group,
  wiMap,
  cols,
}: {
  group: WorkItemGroup<DailyLogWorkItem>;
  wiMap: Map<string, WorkItemRow>;
  cols: number;
}) {
  const formatQty = (w: DailyLogWorkItem, unit: string | null) => {
    if (w.qty_mode === "percent") {
      return `${Math.round(w.qty * 100)}%${unit ? ` (${unit})` : ""}`;
    }
    return `${w.qty}${unit ? " " + unit : ""}`;
  };
  const showHeader = !group.selfOnly && group.groupName;
  return (
    <>
      {showHeader && (
        <tr className="border-b border-[#E0DCD6] bg-[#F5F1EC]">
          <td
            colSpan={cols}
            className="px-4 py-2 text-sm font-semibold text-primary"
          >
            <span className="mr-2 text-xs font-normal text-muted-foreground">
              大項
            </span>
            {group.groupTenderCode && (
              <span className="mr-2 font-mono text-xs text-muted-foreground">
                {group.groupTenderCode}
              </span>
            )}
            {group.groupName}
          </td>
        </tr>
      )}
      {group.items.map((w) => {
        const wi = wiMap.get(w.work_item_id);
        return (
          <tr key={w.work_item_id} className="border-b border-[#E0DCD6]">
            <td className="h-14 px-4 align-top font-mono text-sm text-muted-foreground">
              {wi?.tender_code ?? "—"}
            </td>
            <td className="h-14 px-4 align-top">{wi?.name ?? "—"}</td>
            <td className="h-14 px-4 align-top text-right tabular-nums">
              {formatQty(w, wi?.unit ?? null)}
            </td>
          </tr>
        );
      })}
    </>
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

function ApprovalExtraUnsignedTable({
  rows,
  wiMap,
}: {
  rows: DailyLogWorkItem[];
  wiMap: Map<string, WorkItemRow>;
}) {
  const fmt = (w: DailyLogWorkItem, unit: string | null) => {
    if (w.qty_mode === "percent") {
      return `${Math.round(w.qty * 100)}%${unit ? ` (${unit})` : ""}`;
    }
    return `${w.qty}${unit ? " " + unit : ""}`;
  };
  return (
    <div className="overflow-x-auto rounded-lg border border-[#E0DCD6] bg-card">
      <table className="min-w-full text-base">
        <thead>
          <tr className="bg-primary text-primary-foreground">
            <th className="h-12 px-4 text-left text-sm font-medium tracking-wider">工項</th>
            <th className="h-12 px-4 text-left text-sm font-medium tracking-wider">單位</th>
            <th className="h-12 px-4 text-right text-sm font-medium tracking-wider">完成</th>
            <th className="h-12 px-4 text-left text-sm font-medium tracking-wider">備註</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w, i) => {
            const meta = wiMap.get(w.work_item_id);
            return (
              <tr key={`${w.work_item_id}-${i}`} className="border-b border-[#E0DCD6]">
                <td className="h-14 px-4 align-top">{meta?.name ?? "(已刪除)"}</td>
                <td className="h-14 px-4 align-top">{meta?.unit ?? "—"}</td>
                <td className="h-14 px-4 align-top text-right tabular-nums">
                  {fmt(w, meta?.unit ?? null)}
                </td>
                <td className="h-14 px-4 align-top text-sm text-muted-foreground">
                  {w.note ?? ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
