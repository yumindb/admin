import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatTW, formatDateTW } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { NextStepHint } from "@/components/next-step-hint";
import { PhotoGallery } from "@/components/photo-gallery";
import { getSignedUrls } from "@/lib/supabase/storage";
import { NewReportForm, type CaseOption } from "../new-report-form";
import { deleteFieldReportAction } from "../actions";
// migration-2.16:office_staff/owner 處理回報的工具(下載照片、封存、刪除)
import { OfficeReportTools } from "./office-report-tools";
import type { FieldReport, FieldReportStatus, UserRole } from "@/lib/types";

const STATUS: Record<FieldReportStatus, { label: string; cls: string }> = {
  pending: { label: "待整合", cls: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]" },
  merged: { label: "已併入日誌", cls: "bg-[#ECFDF5] text-[#4A7C59] border-[#A7F3D0]" },
  archived: { label: "已封存", cls: "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]" },
};

const REPORTERS: UserRole[] = ["field_assistant", "site_supervisor", "owner"];

export default async function FieldReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  const { edit: editFlag } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: report } = await supabase
    .from("field_reports")
    .select("*, cases(name, code), author:profiles!author_id(full_name), merged_log:daily_logs!merged_into_log_id(id, log_date)")
    .eq("id", id)
    .maybeSingle();

  if (!report) notFound();
  const r = report as FieldReport & {
    cases: { name: string; code: string | null } | null;
    author: { full_name: string | null } | null;
    merged_log: { id: string; log_date: string } | null;
  };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();

  const isAuthor = r.author_id === user.id;
  const canEdit = isAuthor && r.status === "pending";
  const isOfficeOrOwner =
    profile?.role === "office_staff" || profile?.role === "owner";
  // 辦公室助理 / 老闆:處理過後想清掉。merged 的不能實刪(daily log 反向引用),
  // 改提供「封存」按鈕讓它從 pending 列表退場。
  const canOfficeDelete = isOfficeOrOwner && r.status !== "merged";
  const canOfficeArchive = isOfficeOrOwner && r.status === "pending";
  const status = STATUS[r.status];

  // Storage 已轉 private — 對 r.photos 一次 sign(5 min)
  const reportPhotos = r.photos ?? [];
  const photoSignedMap = await getSignedUrls(
    "daily-photos",
    reportPhotos.map((p) => p.path)
  );
  const signedPhotos = reportPhotos.map((p) => ({
    ...p,
    path: photoSignedMap.get(p.path) ?? p.path,
  }));

  // 編輯模式 — 只有作者本人 + pending 才能進
  if (editFlag === "1") {
    if (!canEdit || !profile || !REPORTERS.includes(profile.role as UserRole)) {
      redirect(`/field-reports/${id}`);
    }

    const { data: cases } = await supabase
      .from("cases")
      .select("id, name, code")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    const caseOptions: CaseOption[] = (cases ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      code: c.code as string | null,
    }));

    return (
      <div className="mx-auto max-w-3xl">
        <nav className="mb-3 text-sm text-muted-foreground">
          <Link href="/field-reports" className="hover:text-accent">
            現場回報
          </Link>
          <span className="mx-1.5">／</span>
          <Link href={`/field-reports/${id}`} className="hover:text-accent">
            {formatTW(r.created_at)}
          </Link>
          <span className="mx-1.5">／</span>
          <span>編輯</span>
        </nav>
        <h1 className="mb-7 text-2xl font-semibold text-primary md:text-3xl">編輯現場回報</h1>
        <NewReportForm
          cases={caseOptions}
          reportId={id}
          initial={{
            caseId: r.case_id,
            note: r.note ?? "",
            photos: r.photos ?? [],
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/field-reports" className="hover:text-accent">
          現場回報
        </Link>
        <span className="mx-1.5">／</span>
        <span>{formatTW(r.created_at)}</span>
      </nav>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs ${status.cls}`}>
            {status.label}
          </span>
          <h1 className="mt-2 text-2xl font-semibold text-primary md:text-3xl">
            {r.cases?.name ?? "(已刪除案件)"}
          </h1>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span>{r.cases?.code ?? "未編號"}</span>
            <span>{formatTW(r.created_at)}</span>
            {r.author?.full_name && <span>{r.author.full_name}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Button asChild variant="outline" className="border-[#E0DCD6]">
              <Link href={`/field-reports/${id}?edit=1`}>編輯</Link>
            </Button>
          )}
          {canEdit && (
            <form action={deleteFieldReportAction}>
              <input type="hidden" name="reportId" value={id} />
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-md border border-[#E0DCD6] bg-white px-3 text-sm text-[#B91C1C] hover:bg-[#FEF2F2]"
              >
                刪除
              </button>
            </form>
          )}
        </div>
      </div>

      {/* 辦公室助理 / 老闆專屬:下載全部照片 + 封存 / 刪除。
          客製需求:主任沒併進日誌的回報要能下載照片 + 處理完刪除。
          沒有照片時仍顯示(讓 office 能刪純文字回報);下載按鈕內部會自動 disable。 */}
      {isOfficeOrOwner && !editFlag && (
        <OfficeReportTools
          reportId={id}
          photos={signedPhotos.map((p) => ({ path: p.path, caption: p.caption }))}
          canDelete={canOfficeDelete}
          canArchive={canOfficeArchive}
        />
      )}

      {r.status === "merged" && r.merged_log && (
        <div className="mb-6">
          <NextStepHint tone="success" title="已整合進日誌">
            這筆回報已被併入{" "}
            <Link
              href={`/logs/${r.merged_log.id}`}
              className="font-medium text-accent underline"
            >
              {formatDateTW(r.merged_log.log_date)} 的施工日誌
            </Link>
            。原始回報保留作為審計紀錄,不可再編輯。
          </NextStepHint>
        </div>
      )}
      {r.status === "pending" && isAuthor && (
        <div className="mb-6">
          <NextStepHint tone="info">
            等工地主任填日誌時整合。如果寫錯,可以點右上「編輯」修改或刪掉。
          </NextStepHint>
        </div>
      )}
      {r.status === "archived" && (
        <div className="mb-6">
          <NextStepHint tone="muted">
            此回報已封存，不再進日誌整合流程。
          </NextStepHint>
        </div>
      )}

      <Section title="文字紀錄">
        {r.note ? (
          <p className="whitespace-pre-line text-sm">{r.note}</p>
        ) : (
          <p className="text-sm text-muted-foreground">(沒有文字)</p>
        )}
      </Section>

      <Section title={`照片 (${reportPhotos.length})`}>
        {!reportPhotos.length ? (
          <p className="text-sm text-muted-foreground">(沒有照片)</p>
        ) : (
          <PhotoGallery photos={signedPhotos} layout="row" />
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
