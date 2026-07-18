import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/db/fetch-all";
import { formatDateTW } from "@/lib/datetime";
import { ApprovalActions } from "./approval-actions";
import { SignSection } from "./sign-section";
import { ExtraItemsTable } from "@/components/extra-items-table";
import { PhotoGallery } from "@/components/photo-gallery";
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
  // 拆三組（同 logs/[id]/page.tsx）
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

  // 辦公室助理視角：審核時想知道「主任本日漏掉哪些合約內工項」。
  // 撈此案件所有「葉節點 + 合約內」工項，與本份日誌已填的對照，列出未填的。
  // 不算 section 層級（那只是分類，不是工項）。
  type CaseLeafItem = {
    id: string;
    name: string;
    unit: string | null;
    tender_code: string | null;
  };
  let missingContractItems: CaseLeafItem[] = [];
  if (l.case_id) {
    // fetchAllRows:配電盤案 1100+ 可填工項,超 PostgREST 1000 筆上限
    const { data: allCaseItems } = await fetchAllRows((from, to) =>
      supabase
        .from("case_work_items")
        .select("id, name, unit, tender_code, item_type, skipped")
        .eq("case_id", l.case_id)
        .eq("skipped", false)
        .in("item_type", ["item", "spec", "manual"])
        .order("id", { ascending: true })
        .range(from, to),
    );
    const filledIds = new Set(contractWorkItems.map((w) => w.work_item_id));
    missingContractItems = ((allCaseItems ?? []) as Array<{
      id: string;
      name: string;
      unit: string | null;
      tender_code: string | null;
      item_type: string;
    }>)
      .filter((it) => !filledIds.has(it.id))
      .map((it) => ({
        id: it.id,
        name: it.name,
        unit: it.unit,
        tender_code: it.tender_code,
      }));
  }
  const totalLeafItemsCount =
    contractWorkItems.length + missingContractItems.length;
  const filledRatio =
    totalLeafItemsCount > 0
      ? contractWorkItems.length / totalLeafItemsCount
      : null;
  const remainingDays = getRemainingDays(l.cases?.expected_end, l.log_date);
  const rawLogPhotos = normalizeLogPhotos(l.photos);
  const photoSignedMap = await getSignedUrls(
    "daily-photos",
    rawLogPhotos.map((p) => p.path),
    // 1h:照片牆有 lazy/分批載入,使用者看頁面超過 5 分鐘再展開,
    // 縮圖才請求 — 5 分鐘效期會 400 破圖
    3600,
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
              title="此日誌的施工日期跟實際填寫日期不同（隔天以上補填）"
            >
              補件
            </span>
          )}
        </div>
        <h1 className="mt-1.5 text-2xl font-semibold text-primary md:text-3xl">
          {l.cases?.name}
        </h1>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-base text-muted-foreground">
          <span>日期：{formatDateTW(l.log_date)}</span>
          <span>{getWeekdayLabel(l.log_date)}</span>
          <span>
            表報編號：
            {buildReportNumber({
              caseCode: l.cases?.code ?? null,
              logDate: l.log_date,
              daySeq,
            })}
          </span>
          <span>工地主任：{l.profiles?.full_name ?? "—"}</span>
          <span>天氣：{formatWeatherSummary(l.weather)}</span>
        </div>
      </div>

      {/* 簽核摘要卡 — 老闆 2 分鐘決定簽或退要先看到的東西。
          手機上其他七大段預設摺疊，要看細節再點開。 */}
      <SignSection title="簽核摘要" alwaysOpen>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
          <SummaryCard
            label="合約內工項"
            value={contractWorkItems.length.toString()}
          />
          <SummaryCard
            label="照片"
            value={logPhotos.length.toString()}
            alert={logPhotos.length === 0}
          />
          <SummaryCard
            label="本日出工"
            value={
              l.manpower?.today_total !== undefined
                ? `${l.manpower.today_total} 人`
                : "—"
            }
          />
          <SummaryCard
            label="合約外"
            value={extraWorkItems.length.toString()}
            alert={extraWorkItems.length > 0}
          />
          <SummaryCard
            label="未簽約"
            value={unsignedWorkItems.length.toString()}
            alert={unsignedWorkItems.length > 0}
          />
        </div>
      </SignSection>

      <SignSection title="表頭摘要">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <InfoCard label="工程名稱" value={l.cases?.name ?? "—"} />
          <InfoCard label="承攬廠商名稱" value={l.cases?.company ?? "—"} />
          <InfoCard label="預定完工日期" value={l.cases?.expected_end ?? "—"} />
          <InfoCard
            label="剩餘工期"
            value={remainingDays === null ? "—" : `${remainingDays} 天`}
          />
        </div>
      </SignSection>

      <SignSection
        title="一、依施工計畫書執行按圖施工概況"
        count={contractWorkItems.length}
      >
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

        {/* 辦公室助理視角:審核時想知道主任本日漏掉哪些合約內工項。
            不一定每天都要全填(自然不會),但提供一目了然的對照能加快判斷。 */}
        {missingContractItems.length > 0 && (
          <details className="mt-3 rounded-md border border-[#E0DCD6] bg-[#FAF7F2]">
            <summary className="cursor-pointer list-none px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden>▸</span>
                本案還有
                <span className="font-medium text-foreground">
                  {missingContractItems.length}
                </span>
                個合約內工項，本日未填
                {filledRatio !== null && (
                  <span className="text-xs text-muted-foreground">
                    （本日填了 {contractWorkItems.length} / {totalLeafItemsCount}，
                    {Math.round(filledRatio * 100)}%）
                  </span>
                )}
              </span>
            </summary>
            <ul className="divide-y divide-[#E0DCD6] border-t border-[#E0DCD6]">
              {missingContractItems.slice(0, 50).map((it) => (
                <li
                  key={it.id}
                  className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                >
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    {it.tender_code && (
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {it.tender_code}
                      </span>
                    )}
                    <span className="truncate">{it.name}</span>
                  </span>
                  {it.unit && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {it.unit}
                    </span>
                  )}
                </li>
              ))}
              {missingContractItems.length > 50 && (
                <li className="px-4 py-2 text-xs text-muted-foreground">
                  …共 {missingContractItems.length} 項，僅顯示前 50。
                </li>
              )}
            </ul>
          </details>
        )}
      </SignSection>

      <SignSection title="二、外包人員及機具管理">
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
      </SignSection>

      {l.vendor_notices && (
        <SignSection title="三、通知協力廠商辦理事項">
          <p className="whitespace-pre-line text-sm">{l.vendor_notices}</p>
        </SignSection>
      )}

      {extraWorkItems.length > 0 && (
        <SignSection
          title="四、合約外項目"
          count={extraWorkItems.length}
          alert="需注意"
        >
          <ApprovalExtraUnsignedTable rows={extraWorkItems} wiMap={wiMap} />
        </SignSection>
      )}

      {unsignedWorkItems.length > 0 && (
        <SignSection
          title="五、未簽約施工內容"
          count={unsignedWorkItems.length}
          alert="需注意"
        >
          <ApprovalExtraUnsignedTable rows={unsignedWorkItems} wiMap={wiMap} />
        </SignSection>
      )}

      {/* 舊資料相容 */}
      {l.extra_items?.length > 0 && (
        <SignSection
          title="（舊）合約外（free-form）"
          count={l.extra_items.length}
        >
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
        </SignSection>
      )}

      {l.unsigned_items?.length > 0 && (
        <SignSection
          title="（舊）未簽約（free-form）"
          count={l.unsigned_items.length}
        >
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
        </SignSection>
      )}

      <SignSection
        title="照片"
        count={logPhotos.length}
        alert={logPhotos.length === 0 ? "無照片" : undefined}
      >
        {!logPhotos.length ? (
          <p className="text-sm text-muted-foreground">無</p>
        ) : (
          // PhotoGallery 自帶 lightbox:核定看照片可以左右滑、縮放,
          // 不再開新分頁(signed URL 過 5 分鐘會 400,斷簽核流程)。
          // initialCount=Infinity:簽核是法律行為,全部照片必須直接可見
          <PhotoGallery photos={logPhotos} initialCount={Infinity} />
        )}
      </SignSection>

      {l.notes && (
        <SignSection title="六、重要事項紀錄">
          <p className="whitespace-pre-line text-sm">{l.notes}</p>
        </SignSection>
      )}

      {/* 簽核 */}
      <div className="mb-4">
        <NextStepHint tone="info">
          {allowedStage === "approve"
            ? "確認上方內容後，在下方簽名按「核定通過」，系統自動跳下一份。要退回切到「退回」分頁。"
            : `確認上方內容後在下方簽名按「${stageCopy.verb}」，系統會把日誌推到下一關。要退回切到「退回」分頁，主任會在「我的日誌」看到並可修正後重送。`}
        </NextStepHint>
      </div>
      <ApprovalActions logId={id} stage={allowedStage} />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-md border px-3 py-2.5 ${
        alert
          ? "border-[#FCA5A5] bg-[#FEF2F2]"
          : "border-[#E0DCD6] bg-white"
      }`}
    >
      <div
        className={`text-xs ${
          alert ? "text-[#B91C1C]" : "text-muted-foreground"
        }`}
      >
        {label}
      </div>
      <div
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          alert ? "text-[#B91C1C]" : "text-primary"
        }`}
      >
        {value}
      </div>
    </div>
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
                <td className="h-14 px-4 align-top">{meta?.name ?? "（已刪除）"}</td>
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
