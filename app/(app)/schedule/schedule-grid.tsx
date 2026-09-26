"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2, WandSparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NextStepHint } from "@/components/next-step-hint";
import { getCompanyShort } from "@/lib/companies";
import { WEEKDAY_LABEL } from "@/lib/payroll/settings";
import { isoWeekday, type Holiday } from "@/lib/payroll/holidays";
import {
  describeEntry,
  entryChipLabel,
  groupEntries,
  indexTemplates,
  shortDateLabel,
  weekDates,
  type ScheduleEntry,
  type ShiftTemplate,
} from "@/lib/payroll/schedule";
import {
  copyWeekScheduleAction,
  fillWeekScheduleAction,
  setDayScheduleAction,
} from "./actions";

export type StaffOpt = { id: string; name: string; role: string; company: string | null };
export type CaseOpt = { id: string; label: string; paused: boolean };

const ROLE_LABEL: Record<string, string> = {
  owner: "老闆",
  office_staff: "助理",
  site_supervisor: "主任",
  field_assistant: "現場",
};
const ROLE_ORDER = ["site_supervisor", "field_assistant", "office_staff", "owner"];

type DraftEntry = {
  key: number;
  shiftTemplateId: string | null; // null = 自訂
  startTime: string;
  endTime: string;
  caseId: string | null;
};

export function ScheduleGrid({
  weekStart,
  prevWeek,
  nextWeek,
  thisWeek,
  today,
  staff,
  templates,
  entries,
  cases,
  holidays,
  canEdit,
}: {
  weekStart: string;
  prevWeek: string;
  nextWeek: string;
  thisWeek: string;
  today: string;
  staff: StaffOpt[];
  templates: ShiftTemplate[];
  entries: ScheduleEntry[];
  cases: CaseOpt[];
  holidays: Holiday[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const dates = weekDates(weekStart);
  const templatesById = useMemo(() => indexTemplates(templates), [templates]);
  const activeTemplates = templates.filter((t) => t.is_active);
  const grouped = useMemo(() => groupEntries(entries), [entries]);
  const holidayByDate = useMemo(() => {
    const m = new Map<string, Holiday>();
    for (const h of holidays) m.set(h.holiday_date, h);
    return m;
  }, [holidays]);
  const caseLabelById = useMemo(() => new Map(cases.map((c) => [c.id, c.label])), [cases]);

  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [editing, setEditing] = useState<{ staff: StaffOpt; date: string } | null>(null);
  const [showFill, setShowFill] = useState(false);
  const [showCopy, setShowCopy] = useState(false);

  const companies = Array.from(new Set(staff.map((s) => s.company).filter((c): c is string => !!c)));
  const visibleStaff = staff
    .filter((s) => (roleFilter === "all" ? true : s.role === roleFilter))
    .filter((s) => (companyFilter === "all" ? true : s.company === companyFilter))
    .sort((a, b) => {
      const r = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
      return r !== 0 ? r : a.name.localeCompare(b.name, "zh-TW");
    });

  const totalEntries = entries.length;

  return (
    <div className="space-y-4">
      {/* 週導覽 + 工具列 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-md border border-[#E0DCD6] bg-white">
          <Link href={`/schedule?week=${prevWeek}`} className="px-2 py-2 text-muted-foreground hover:text-accent" title="上一週">
            <ChevronLeft className="size-4" />
          </Link>
          <span className="px-2 text-sm font-medium text-primary">
            {shortDateLabel(dates[0])} – {shortDateLabel(dates[6])}
            <span className="ml-1 text-xs font-normal text-muted-foreground">{dates[0].slice(0, 4)} 年</span>
          </span>
          <Link href={`/schedule?week=${nextWeek}`} className="px-2 py-2 text-muted-foreground hover:text-accent" title="下一週">
            <ChevronRight className="size-4" />
          </Link>
        </div>
        {weekStart !== thisWeek && (
          <Link href={`/schedule?week=${thisWeek}`} className="text-sm text-primary underline-offset-4 hover:underline">
            回本週
          </Link>
        )}

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="h-9 rounded-md border border-[#E0DCD6] bg-white px-2 text-sm"
        >
          <option value="all">全部角色</option>
          <option value="site_supervisor">工地主任</option>
          <option value="field_assistant">現場人員</option>
          <option value="office_staff">辦公室助理</option>
          <option value="owner">老闆</option>
        </select>
        {companies.length > 1 && (
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="h-9 rounded-md border border-[#E0DCD6] bg-white px-2 text-sm"
          >
            <option value="all">全部公司</option>
            {companies.map((c) => (
              <option key={c} value={c}>{getCompanyShort(c)}</option>
            ))}
          </select>
        )}

        {canEdit && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowFill(true)} disabled={activeTemplates.length === 0}>
              <WandSparkles className="size-4" /> 快速排班
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setShowCopy(true)}>
              <Copy className="size-4" /> 複製上週
            </Button>
          </div>
        )}
      </div>

      {activeTemplates.length === 0 && canEdit && (
        <NextStepHint tone="warning" title="還沒有可用的班別">
          先到 <Link href="/schedule/templates" className="underline">班別範本</Link> 建一個(例如日班 08:00–17:00),才能排班。
        </NextStepHint>
      )}

      {/* 格子 */}
      <div className="overflow-x-auto rounded-md border border-[#E0DCD6] bg-card">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <thead>
            <tr className="bg-[#F5F1EC]/60 text-xs text-muted-foreground">
              <th className="sticky left-0 z-10 w-40 bg-[#F5F1EC] px-3 py-2 text-left font-medium">人員</th>
              {dates.map((d) => {
                const h = holidayByDate.get(d);
                const wd = isoWeekday(d);
                const off = h ? !h.is_workday : wd >= 6;
                return (
                  <th
                    key={d}
                    className={`px-2 py-2 text-center font-medium ${d === today ? "text-accent" : ""} ${off ? "bg-[#EFEAE3]/70" : ""}`}
                  >
                    <div>{WEEKDAY_LABEL[wd]}</div>
                    <div className={`text-sm ${d === today ? "font-semibold" : "text-foreground"}`}>{shortDateLabel(d)}</div>
                    {h && <div className="mt-0.5 truncate text-[11px] text-[#92400E]">{h.name}</div>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EBE4]">
            {visibleStaff.map((s) => {
              const byDate = grouped.get(s.id);
              return (
                <tr key={s.id} className="hover:bg-[#F5F1EC]/30">
                  <td className="sticky left-0 z-10 bg-card px-3 py-1.5">
                    <div className="truncate font-medium text-primary">{s.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {ROLE_LABEL[s.role] ?? s.role}
                      {s.company && companies.length > 1 ? `・${getCompanyShort(s.company)}` : ""}
                    </div>
                  </td>
                  {dates.map((d) => {
                    const list = byDate?.get(d) ?? [];
                    const h = holidayByDate.get(d);
                    const off = h ? !h.is_workday : isoWeekday(d) >= 6;
                    return (
                      <td key={d} className={`p-1 align-top ${off ? "bg-[#EFEAE3]/40" : ""}`}>
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => setEditing({ staff: s, date: d })}
                          className={`flex min-h-11 w-full flex-col items-stretch gap-1 rounded-md border px-1.5 py-1 text-left transition-colors ${
                            canEdit ? "hover:border-accent" : "cursor-default"
                          } ${list.length > 0 ? "border-[#E0DCD6] bg-white" : "border-dashed border-[#E0DCD6]/80 bg-transparent"}`}
                          title={canEdit ? "點一下排班" : undefined}
                        >
                          {list.length === 0 ? (
                            <span className="text-[11px] text-muted-foreground/60">{canEdit ? "＋" : "—"}</span>
                          ) : (
                            list.map((e) => (
                              <span key={e.id} className="flex items-center gap-1 text-xs">
                                <span className="inline-flex min-w-6 shrink-0 items-center justify-center rounded bg-primary/10 px-1 font-medium text-primary">
                                  {entryChipLabel(e, templatesById)}
                                </span>
                                <span className="truncate text-muted-foreground">
                                  {e.case_id ? (caseLabelById.get(e.case_id)?.split("｜")[0] ?? "案件") : ""}
                                </span>
                              </span>
                            ))
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {visibleStaff.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">沒有符合篩選的人員</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>本週共 {totalEntries} 段班</span>
        {activeTemplates.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1">
            <span className="inline-flex min-w-6 items-center justify-center rounded bg-primary/10 px-1 font-medium text-primary">{t.short_name}</span>
            {t.name} {t.start_time}–{t.end_time}
          </span>
        ))}
        <span>灰底 = 休息日／例假日／國定假日</span>
      </div>

      {editing && (
        <DayEditor
          staff={editing.staff}
          date={editing.date}
          existing={grouped.get(editing.staff.id)?.get(editing.date) ?? []}
          templates={activeTemplates}
          templatesById={templatesById}
          cases={cases}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
      {showFill && (
        <FillWeekDialog
          weekStart={weekStart}
          staff={visibleStaff}
          templates={activeTemplates}
          onClose={() => setShowFill(false)}
          onDone={() => {
            setShowFill(false);
            router.refresh();
          }}
        />
      )}
      {showCopy && (
        <CopyWeekDialog
          weekStart={weekStart}
          prevWeek={prevWeek}
          onClose={() => setShowCopy(false)}
          onDone={() => {
            setShowCopy(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 共用 modal 外框                                                      */
/* ------------------------------------------------------------------ */

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-lg border border-[#E0DCD6] bg-card shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#E0DCD6] px-5 py-3">
          <h2 className="text-base font-semibold text-primary">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-[#F5F1EC] hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

const selectCls = "h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-2 text-sm";

/* ------------------------------------------------------------------ */
/* 某人某天                                                            */
/* ------------------------------------------------------------------ */

function DayEditor({
  staff,
  date,
  existing,
  templates,
  templatesById,
  cases,
  onClose,
  onSaved,
}: {
  staff: StaffOpt;
  date: string;
  existing: ScheduleEntry[];
  templates: ShiftTemplate[];
  templatesById: Map<string, ShiftTemplate>;
  cases: CaseOpt[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const defaultTemplate = templates[0]?.id ?? null;
  const [rows, setRows] = useState<DraftEntry[]>(() =>
    existing.length > 0
      ? existing.map((e, i) => ({
          key: i,
          shiftTemplateId: e.shift_template_id,
          startTime: e.start_time ?? "",
          endTime: e.end_time ?? "",
          caseId: e.case_id,
        }))
      : defaultTemplate
        ? [{ key: 0, shiftTemplateId: defaultTemplate, startTime: "", endTime: "", caseId: null }]
        : [],
  );
  const [note, setNote] = useState(existing.find((e) => e.note)?.note ?? "");
  const [isPending, startTransition] = useTransition();

  function update(key: number, patch: Partial<DraftEntry>) {
    setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function save(list: DraftEntry[]) {
    startTransition(async () => {
      const res = await setDayScheduleAction({
        userId: staff.id,
        workDate: date,
        entries: list.map((r) => ({
          shiftTemplateId: r.shiftTemplateId,
          startTime: r.shiftTemplateId ? undefined : r.startTime,
          endTime: r.shiftTemplateId ? undefined : r.endTime,
          caseId: r.caseId,
        })),
        note,
      });
      if (res.ok) {
        toast.success(list.length === 0 ? `已清掉 ${staff.name} ${shortDateLabel(date)} 的班` : `已排 ${staff.name} ${shortDateLabel(date)}`);
        onSaved();
      } else {
        toast.error(res.fieldErrors ? Object.values(res.fieldErrors).flat()[0] ?? res.error : res.error);
      }
    });
  }

  return (
    <Modal title={`${staff.name}・${WEEKDAY_LABEL[isoWeekday(date)]} ${shortDateLabel(date)}`} onClose={onClose}>
      <div className="space-y-4">
        {existing.length > 0 && (
          <div className="text-xs text-muted-foreground">
            目前:{existing.map((e) => describeEntry(e, templatesById)).join("、")}
          </div>
        )}

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.key} className="space-y-2 rounded-md border border-[#F0EBE4] bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">第 {i + 1} 段</span>
                <button
                  type="button"
                  onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
                  className="inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] px-2 py-0.5 text-xs text-[#B91C1C] hover:bg-[#FEF2F2]"
                >
                  <Trash2 className="size-3" /> 移除
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div>
                  <Label>班別</Label>
                  <select
                    value={r.shiftTemplateId ?? "custom"}
                    onChange={(e) => update(r.key, { shiftTemplateId: e.target.value === "custom" ? null : e.target.value })}
                    className={`mt-1 ${selectCls}`}
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} {t.start_time}–{t.end_time}
                      </option>
                    ))}
                    <option value="custom">自訂時間…</option>
                  </select>
                </div>
                <div>
                  <Label>案件（選填）</Label>
                  <select
                    value={r.caseId ?? ""}
                    onChange={(e) => update(r.key, { caseId: e.target.value || null })}
                    className={`mt-1 ${selectCls}`}
                  >
                    <option value="">不指定</option>
                    {cases.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}{c.paused ? "（暫停）" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {r.shiftTemplateId === null && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor={`st-${r.key}`}>上班</Label>
                    <Input id={`st-${r.key}`} type="time" value={r.startTime} onChange={(e) => update(r.key, { startTime: e.target.value })} className="mt-1 h-10 md:h-10" />
                  </div>
                  <div>
                    <Label htmlFor={`et-${r.key}`}>下班</Label>
                    <Input id={`et-${r.key}`} type="time" value={r.endTime} onChange={(e) => update(r.key, { endTime: e.target.value })} className="mt-1 h-10 md:h-10" />
                  </div>
                </div>
              )}
            </div>
          ))}
          {rows.length < 4 && (
            <button
              type="button"
              onClick={() =>
                setRows([...rows, { key: Date.now(), shiftTemplateId: defaultTemplate, startTime: "", endTime: "", caseId: null }])
              }
              className="inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-white px-2.5 py-1 text-xs text-foreground hover:border-accent hover:text-accent"
            >
              <Plus className="size-3" /> 再加一段（兩頭班）
            </button>
          )}
        </div>

        <div>
          <Label htmlFor="day-note">備註（選填）</Label>
          <Input id="day-note" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="例:支援 A 案、下午請假" className="mt-1 h-10 md:h-10" />
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => save([])} disabled={isPending || existing.length === 0} className="text-[#B91C1C]">
            清掉這天
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="button" onClick={() => save(rows)} disabled={isPending || rows.length === 0}>
              {isPending ? "儲存中…" : "儲存"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* 快速排班                                                            */
/* ------------------------------------------------------------------ */

function FillWeekDialog({
  weekStart,
  staff,
  templates,
  onClose,
  onDone,
}: {
  weekStart: string;
  staff: StaffOpt[];
  templates: ShiftTemplate[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(staff.filter((s) => s.role === "site_supervisor" || s.role === "field_assistant").map((s) => s.id)),
  );
  const [isPending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await fillWeekScheduleAction({
        weekStart,
        shiftTemplateId: templateId,
        weekdays,
        userIds: Array.from(selected),
      });
      if (res.ok) {
        toast.success(res.inserted ? `已填入 ${res.inserted} 段班(已排的沒動)` : "這些日子都已經有班了,沒有新增");
        onDone();
      } else toast.error(res.error);
    });
  }

  return (
    <Modal title="快速排班(只填還沒排的日子)" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <Label>班別</Label>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={`mt-1 ${selectCls}`}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} {t.start_time}–{t.end_time}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>星期</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
              const on = weekdays.includes(wd);
              return (
                <button
                  key={wd}
                  type="button"
                  onClick={() => setWeekdays(on ? weekdays.filter((x) => x !== wd) : [...weekdays, wd].sort())}
                  className={`rounded-md border px-3 py-1.5 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "border-[#E0DCD6] bg-white text-foreground"}`}
                >
                  {WEEKDAY_LABEL[wd]}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label>人員（{selected.size} / {staff.length}）</Label>
            <div className="flex gap-2 text-xs">
              <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => setSelected(new Set(staff.map((s) => s.id)))}>全選</button>
              <button type="button" className="text-muted-foreground underline-offset-4 hover:underline" onClick={() => setSelected(new Set())}>全不選</button>
            </div>
          </div>
          <div className="mt-1 max-h-48 divide-y divide-[#F0EBE4] overflow-y-auto rounded-md border border-[#E0DCD6] bg-white">
            {staff.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(s.id);
                    else next.delete(s.id);
                    setSelected(next);
                  }}
                  className="size-4 accent-[#003153]"
                />
                <span className="text-foreground">{s.name}</span>
                <span className="text-xs text-muted-foreground">{ROLE_LABEL[s.role] ?? s.role}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
          <Button type="button" onClick={run} disabled={isPending || !templateId || weekdays.length === 0 || selected.size === 0}>
            {isPending ? "填入中…" : "填入"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* 複製上週                                                            */
/* ------------------------------------------------------------------ */

function CopyWeekDialog({
  weekStart,
  prevWeek,
  onClose,
  onDone,
}: {
  weekStart: string;
  prevWeek: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const from = weekDates(prevWeek);
  const to = weekDates(weekStart);

  function run() {
    startTransition(async () => {
      const res = await copyWeekScheduleAction({ fromWeekStart: prevWeek, toWeekStart: weekStart });
      if (res.ok) {
        toast.success(`已複製 ${res.users} 人、${res.copied} 段班`);
        onDone();
      } else toast.error(res.error);
    });
  }

  return (
    <Modal title="複製上週的班到這週" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p>
          把 <span className="font-medium">{shortDateLabel(from[0])}–{shortDateLabel(from[6])}</span> 的排班複製到{" "}
          <span className="font-medium">{shortDateLabel(to[0])}–{shortDateLabel(to[6])}</span>。
        </p>
        <NextStepHint tone="warning">
          上週有排班的人,這週會整週被覆寫成跟上週一樣;上週沒排的人不動。
        </NextStepHint>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
          <Button type="button" onClick={run} disabled={isPending}>
            {isPending ? "複製中…" : "複製"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
