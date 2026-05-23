import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import { formatTW, formatDateTW } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { ExtraItemsTable } from "@/components/extra-items-table";
import { NextStepHint } from "@/components/next-step-hint";
import { PhotoGallery } from "@/components/photo-gallery";
import { PdfDownloadButton } from "@/components/pdf-download-button";
import { getSignedUrls } from "@/lib/supabase/storage";
import { deleteLogAction } from "../new/actions";
import {
  buildReportNumber,
  formatWeatherSummary,
  getRemainingDays,
  getWeekdayLabel,
  isBackfilledLog,
  normalizeLogPhotos,
} from "@/lib/daily-log";
import type {
  DailyLog,
  DailyLogEditableField,
  DailyLogWorkItem,
  LogApproval,
} from "@/lib/types";
import {
  fetchWorkItemAncestry,
  groupWorkItemsByAncestor,
  type WorkItemGroup,
} from "@/lib/work-item-grouping";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]" },
  // submitted 用「簽核中」當基底,實際顯示時依 current_stage 接「:複核 / :審核 / :核定」
  submitted: { label: "簽核中", cls: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]" },
  approved: { label: "已核定", cls: "bg-[#ECFDF5] text-[#4A7C59] border-[#A7F3D0]" },
  rejected: { label: "已退回", cls: "bg-[#FEF2F2] text-[#B91C1C] border-[#FCA5A5]" },
};

// 完整版 — 顯示在 NextStepHint / 簽核紀錄 etc.
const STAGE_LABEL: Record<string, string> = {
  fill: "填表(工地主任)",
  review: "複核(工地主任)",
  audit: "審核(辦公室助理)",
  approve: "核定(老闆)",
};

// 簡短版 — 接在 status badge 後綴用,如「簽核中:審核」
const STAGE_LABEL_SHORT: Record<string, string> = {
  fill: "填表",
  review: "複核",
  audit: "審核",
  approve: "核定",
};

const ROLE_LABEL: Record<string, string> = {
  site_supervisor: "工地主任",
  office_staff: "辦公室助理",
  owner: "老闆",
  field_assistant: "現場人員",
};

const STATUS_AT_EDIT_LABEL: Record<string, string> = {
  draft: "草稿",
  submitted: "簽核中",
  approved: "已核定",
  rejected: "已退回",
};

const FIELD_LABEL: Record<DailyLogEditableField, string> = {
  log_date: "日期",
  weather: "天氣",
  manpower: "出工/外包/機具",
  work_items: "施工工項",
  extra_items: "非合約內項目",
  unsigned_items: "未簽約項目",
  photos: "照片",
  vendor_notices: "通知協力廠商事項",
  notes: "重要事項紀錄",
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

  // 角色守則:field_assistant 一律不能看 log 詳細頁;
  //   site_supervisor 只能看自己 supervisor_id 的 log;
  //   office_staff / owner 都能看。
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role === "field_assistant") redirect("/");

  const supabase = await createClient();

  const { data: log } = await supabase
    .from("daily_logs")
    .select("*, cases(id, name, code, company, expected_end)")
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
  };

  if (actor.role === "site_supervisor" && l.supervisor_id !== actor.id) {
    redirect("/");
  }

  const user = { id: actor.id };
  const profile = { role: actor.role };
  const isOwnerOfLog = l.supervisor_id === actor.id;
  const role = actor.role;

  // 編輯權限:
  //   - draft → 只 supervisor 本人(原規則,走主流程編輯)
  //   - rejected → supervisor 本人(主流程,重新送出);office_staff/owner(silent edit)
  //   - submitted → supervisor 本人 / office_staff / owner(silent edit)
  //   - approved → 一律不可
  const canEdit =
    l.status === "draft"
      ? isOwnerOfLog && role === "site_supervisor"
      : l.status === "rejected" || l.status === "submitted"
        ? (role === "site_supervisor" && isOwnerOfLog) ||
          role === "office_staff" ||
          role === "owner"
        : false;

  // 表報編號需要該案件當日序號 — 算 created_at <= 自己的同日同案 row 數
  const { count: dayCount } = await supabase
    .from("daily_logs")
    .select("id", { count: "exact", head: true })
    .eq("case_id", l.case_id)
    .eq("log_date", l.log_date)
    .lte("created_at", l.created_at);
  const daySeq = dayCount ?? 1;

  const workItemIds = (l.work_items ?? []).map((w) => w.work_item_id);
  const ancestry = await fetchWorkItemAncestry(supabase, workItemIds);
  const wiMap = new Map<string, WorkItemRow>();
  for (const [id, n] of ancestry) {
    wiMap.set(id, { id, name: n.name, unit: n.unit, tender_code: n.tender_code });
  }
  // 把 log 的 work_items 依 case_work_items.item_type 拆三組:合約內 / 合約外 / 未簽約
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

  const { data: approvals } = await supabase
    .from("log_approvals")
    .select("*")
    .eq("log_id", id)
    .order("created_at", { ascending: true });
  const apList = (approvals ?? []) as LogApproval[];

  // 送出後編輯軌跡(post-submission edits) — 連 editor 名稱一起撈
  const { data: revisionRows } = await supabase
    .from("daily_log_revisions")
    .select(
      "id, log_id, editor_id, editor_role, edited_at, log_status_at_edit, changed_fields, reason, editor:profiles!editor_id(full_name)"
    )
    .eq("log_id", id)
    .order("edited_at", { ascending: false });
  type RevisionRow = {
    id: string;
    editor_id: string | null;
    editor_role: string;
    edited_at: string;
    log_status_at_edit: string;
    changed_fields: DailyLogEditableField[];
    reason: string | null;
    editor: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  const revisions = ((revisionRows ?? []) as unknown as RevisionRow[]).map((r) => {
    const editor = Array.isArray(r.editor) ? r.editor[0] : r.editor;
    return {
      id: r.id,
      editorName: editor?.full_name ?? "(已離職 / 未命名)",
      editorRole: r.editor_role,
      editedAt: r.edited_at,
      logStatusAtEdit: r.log_status_at_edit,
      changedFields: r.changed_fields ?? [],
      reason: r.reason,
    };
  });

  const s = STATUS[l.status] ?? STATUS.draft;
  const remainingDays = getRemainingDays(l.cases?.expected_end, l.log_date);
  const rawLogPhotos = normalizeLogPhotos(l.photos);

  // Storage 已轉 private → signed URL(5 min)。歷史資料 path 是完整 public URL,
  // 新資料是 storage path,helper 同時吃兩種。
  const photoSignedMap = await getSignedUrls(
    "daily-photos",
    rawLogPhotos.map((p) => p.path)
  );
  const logPhotos = rawLogPhotos.map((p) => ({
    ...p,
    path: photoSignedMap.get(p.path) ?? p.path,
  }));

  // 簽核紀錄的簽名圖也轉 signed URL
  const sigInputs = apList
    .map((a) => a.signature_url)
    .filter((s): s is string => !!s);
  const sigSignedMap = await getSignedUrls("signatures", sigInputs);
  const apListSigned = apList.map((a) => ({
    ...a,
    signature_url: a.signature_url
      ? sigSignedMap.get(a.signature_url) ?? a.signature_url
      : null,
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/logs" className="hover:text-accent">
          日誌
        </Link>
        <span className="mx-1.5">／</span>
        <span>
          {l.cases?.name ?? "(已刪除)"} ·{" "}
          {formatDateTW(l.log_date)}
        </span>
      </nav>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-block rounded-full border px-2.5 py-0.5 text-xs ${s.cls}`}
            >
              {s.label}
              {l.status === "submitted" && l.current_stage
                ? `:${STAGE_LABEL_SHORT[l.current_stage] ?? l.current_stage}`
                : ""}
            </span>
            {isBackfilledLog(l) && (
              <span
                className="inline-block rounded-full border border-[#FDBA74] bg-[#FFF7ED] px-2.5 py-0.5 text-xs text-[#C2410C]"
                title="此日誌的施工日期跟實際填寫日期不同(隔天以上補填)"
              >
                補件
              </span>
            )}
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-primary md:text-3xl">
            {formatDateTW(l.log_date)} ·{" "}
            {l.cases?.name}
          </h1>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-base text-muted-foreground">
            <span>
              表報編號:
              {buildReportNumber({
                caseCode: l.cases?.code ?? null,
                logDate: l.log_date,
                daySeq,
              })}
            </span>
            <span>{getWeekdayLabel(l.log_date)}</span>
            <span>天氣:{formatWeatherSummary(l.weather)}</span>
            {l.manpower?.today_total !== undefined && (
              <span>本日出工 {l.manpower.today_total} 人</span>
            )}
            {l.manpower?.accumulated_total !== undefined && (
              <span>累計出工 {l.manpower.accumulated_total} 人次</span>
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
          {canEdit && l.status === "draft" && isOwnerOfLog && (
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
          {l.status === "submitted" && (
            (profile?.role === "site_supervisor" && l.current_stage === "review" && l.supervisor_id === user!.id) ||
            (profile?.role === "office_staff" && l.current_stage === "audit") ||
            (profile?.role === "owner" && l.current_stage === "approve")
          ) && (
            <Button
              asChild
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Link href={`/approvals/${id}`}>
                前往
                {l.current_stage === "review"
                  ? "複核"
                  : l.current_stage === "audit"
                  ? "審核"
                  : "核定"}
              </Link>
            </Button>
          )}
          {l.status === "approved" && (
            <PdfDownloadButton
              logId={id}
              hasPdf={!!l.pdf_path}
              pdfStatus={l.pdf_status}
              pdfError={l.pdf_error}
            />
          )}
          {(role === "site_supervisor" || role === "owner") && (
            <Button
              asChild
              variant="outline"
              className="border-[#E0DCD6]"
            >
              <Link href={`/logs/new?from=${id}`}>複製為新日誌</Link>
            </Button>
          )}
        </div>
      </div>

      {/* 下一步提示 — 依日誌狀態給不同訊息 */}
      {l.status === "draft" && isOwnerOfLog && (
        <div className="mb-6">
          <NextStepHint tone="warning" title="尚未送出">
            這份還是草稿,老闆不會收到。確認內容後請按右上「編輯」→ 表單底「送出核定」。
          </NextStepHint>
        </div>
      )}
      {/* 四關正式流程的 status hint:依 current_stage × 角色 細分 */}
      {l.status === "submitted" && (() => {
        const stage = l.current_stage;
        const stageLabel: Record<string, string> = {
          review: "複核(工地主任)",
          audit: "審核(辦公室助理)",
          approve: "核定(老闆)",
        };
        const myStage =
          profile?.role === "site_supervisor"
            ? "review"
            : profile?.role === "office_staff"
            ? "audit"
            : profile?.role === "owner"
            ? "approve"
            : null;
        const isMyTurn = stage && myStage === stage;
        if (isMyTurn) {
          return (
            <div className="mb-6">
              <NextStepHint tone="info" title={`待你${stage === "review" ? "複核" : stage === "audit" ? "審核" : "核定"}`}>
                這份等你處理,點右上「前往{stage === "review" ? "複核" : stage === "audit" ? "審核" : "核定"}」進入。
              </NextStepHint>
            </div>
          );
        }
        return (
          <div className="mb-6">
            <NextStepHint tone="info" title={`已送出,目前在「${stage ? stageLabel[stage] : "?"}」階段`}>
              {stage === "review"
                ? "工地主任複核中。"
                : stage === "audit"
                ? "辦公室助理審核中。"
                : stage === "approve"
                ? "老闆核定中,簽名後即完成。"
                : "等待中。"}
            </NextStepHint>
          </div>
        );
      })()}
      {l.status === "rejected" && isOwnerOfLog && (
        <div className="mb-6">
          <NextStepHint tone="warning" title="已被退回">
            請查看下方「簽核歷程」的退回原因,點右上「編輯」修正後重新送出。
          </NextStepHint>
        </div>
      )}
      {l.status === "approved" && (
        <div className="mb-6">
          <NextStepHint tone="success" title="已核定">
            這份已完成核定,簽名與時間記錄在下方「簽核歷程」。對應工項的「累計完成」也已更新。
          </NextStepHint>
        </div>
      )}

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
          <p className="text-sm text-muted-foreground">未填合約內工項</p>
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
                    當日完成
                  </th>
                  <th className="h-12 px-4 text-left text-sm font-medium tracking-wider">
                    備註
                  </th>
                </tr>
              </thead>
              <tbody>
                {workItemGroups.map((g, gi) => (
                  <GroupRows
                    key={g.groupId ?? `orphan-${gi}`}
                    group={g}
                    wiMap={wiMap}
                    cols={4}
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
          <NewExtraUnsignedTable
            rows={extraWorkItems}
            wiMap={wiMap}
          />
        </Section>
      )}

      {unsignedWorkItems.length > 0 && (
        <Section title={`五、未簽約施工內容 (${unsignedWorkItems.length})`}>
          <NewExtraUnsignedTable
            rows={unsignedWorkItems}
            wiMap={wiMap}
          />
        </Section>
      )}

      {/* 舊資料相容:升等前 jsonb 內的 free-form 合約外/未簽約 */}
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

      {/* 照片 */}
      <Section title={`照片 (${logPhotos.length})`}>
        {!logPhotos.length ? (
          <p className="text-sm text-muted-foreground">沒有照片</p>
        ) : (
          <PhotoGallery photos={logPhotos} layout="grid" />
        )}
      </Section>

      {/* 備註 */}
      {l.notes && (
        <Section title="六、重要事項紀錄">
          <p className="whitespace-pre-line text-sm">{l.notes}</p>
        </Section>
      )}

      {/* 送出後編輯軌跡 — 只在有編輯時顯示 */}
      {revisions.length > 0 && (
        <Section title={`編輯軌跡 (${revisions.length})`}>
          <ul className="space-y-2">
            {revisions.map((r) => (
              <li
                key={r.id}
                className="rounded-md border border-[#E0DCD6] bg-card px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium text-primary">
                    {r.editorName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {ROLE_LABEL[r.editorRole] ?? r.editorRole}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    編輯時狀態：
                    {STATUS_AT_EDIT_LABEL[r.logStatusAtEdit] ?? r.logStatusAtEdit}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatTW(r.editedAt)}
                  </span>
                </div>
                {r.changedFields.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {r.changedFields.map((f) => (
                      <span
                        key={f}
                        className="inline-block rounded-full border border-[#E0DCD6] bg-[#FAF7F2] px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {FIELD_LABEL[f] ?? f}
                      </span>
                    ))}
                  </div>
                )}
                {r.reason && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    備註:{r.reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 簽核歷程 */}
      <Section title="簽核歷程">
        {!apList.length ? (
          <p className="text-sm text-muted-foreground">尚未送出</p>
        ) : (
          <ul className="space-y-2">
            {apListSigned.map((a) => (
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
                  {formatTW(a.created_at)}
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
            <td className="h-14 px-4 align-top">
              {wi?.name ?? "(已刪除工項)"}
            </td>
            <td className="h-14 px-4 align-top text-right tabular-nums">
              {formatLogQty(w.qty, w.qty_mode, wi?.unit ?? null)}
            </td>
            <td className="h-14 px-4 align-top text-sm text-muted-foreground">
              {w.note ?? ""}
            </td>
          </tr>
        );
      })}
    </>
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

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#E0DCD6] bg-white px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium text-primary">{value}</div>
    </div>
  );
}

/** 合約外 / 未簽約 在 log 內的呈現 — 從 daily_logs.work_items + case_work_items 解。
 *  欄位:工項名 / 單位 / 當日完成 / 備註(輕量,跟合約內表結構接近)。 */
function NewExtraUnsignedTable({
  rows,
  wiMap,
}: {
  rows: DailyLogWorkItem[];
  wiMap: Map<string, WorkItemRow>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#E0DCD6] bg-card">
      <table className="min-w-full text-base">
        <thead>
          <tr className="bg-primary text-primary-foreground">
            <th className="h-12 px-4 text-left text-sm font-medium tracking-wider">工項</th>
            <th className="h-12 px-4 text-left text-sm font-medium tracking-wider">單位</th>
            <th className="h-12 px-4 text-right text-sm font-medium tracking-wider">當日完成</th>
            <th className="h-12 px-4 text-left text-sm font-medium tracking-wider">備註</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w, i) => {
            const meta = wiMap.get(w.work_item_id);
            return (
              <tr key={`${w.work_item_id}-${i}`} className="border-b border-[#E0DCD6]">
                <td className="h-14 px-4 align-top">
                  <div>{meta?.name ?? "(已刪除)"}</div>
                </td>
                <td className="h-14 px-4 align-top">{meta?.unit ?? "—"}</td>
                <td className="h-14 px-4 text-right align-top tabular-nums">
                  {formatLogQty(w.qty, w.qty_mode, meta?.unit ?? null)}
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
