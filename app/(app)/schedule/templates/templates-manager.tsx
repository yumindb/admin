"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Power, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NextStepHint } from "@/components/next-step-hint";
import { crossesMidnight, shiftDurationMinutes, type ShiftTemplate } from "@/lib/payroll/schedule";
import { saveShiftTemplateAction, setShiftTemplateActiveAction } from "../actions";

export function TemplatesManager({ rows }: { rows: ShiftTemplate[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ShiftTemplate | "new" | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(t: ShiftTemplate) {
    startTransition(async () => {
      const res = await setShiftTemplateActiveAction({ id: t.id, isActive: !t.is_active });
      if (res.ok) {
        toast.success(t.is_active ? `已停用「${t.name}」` : `已啟用「${t.name}」`);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setEditing("new")}>
          <Plus className="size-4" /> 新增班別
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-[#E0DCD6] bg-card">
        <table className="w-full text-sm">
          <thead className="bg-[#F5F1EC]/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">短名</th>
              <th className="px-4 py-2.5 font-medium">名稱</th>
              <th className="px-4 py-2.5 font-medium">時間</th>
              <th className="px-4 py-2.5 font-medium">休息</th>
              <th className="px-4 py-2.5 font-medium">工時</th>
              <th className="px-4 py-2.5 font-medium">狀態</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EBE4]">
            {rows.map((t) => {
              const minutes = shiftDurationMinutes(t.start_time, t.end_time, t.break_minutes);
              return (
                <tr key={t.id} className={`hover:bg-[#F5F1EC]/40 ${t.is_active ? "" : "opacity-60"}`}>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex min-w-6 items-center justify-center rounded bg-primary/10 px-1.5 font-medium text-primary">{t.short_name}</span>
                  </td>
                  <td className="px-4 py-2.5 font-medium text-foreground">{t.name}</td>
                  <td className="px-4 py-2.5 font-mono text-foreground">
                    {t.start_time}–{t.end_time}
                    {crossesMidnight(t.start_time, t.end_time) && <span className="ml-1 text-xs text-muted-foreground">跨日</span>}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{t.break_minutes} 分</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{(minutes / 60).toFixed(1).replace(/\.0$/, "")} 小時</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${t.is_active ? "border-[#A7F3D0] bg-[#ECFDF5] text-[#4A7C59]" : "border-[#E5E7EB] bg-[#F3F4F6] text-[#6B7280]"}`}>
                      {t.is_active ? "啟用中" : "已停用"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => setEditing(t)} className="inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-white px-2 py-1 text-xs text-foreground hover:border-accent hover:text-accent">
                        <Pencil className="size-3" /> 編輯
                      </button>
                      <button
                        type="button"
                        onClick={() => toggle(t)}
                        disabled={isPending}
                        className={`inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-xs disabled:opacity-50 ${t.is_active ? "border-[#FCA5A5] text-[#B91C1C] hover:bg-[#FEF2F2]" : "border-[#A7F3D0] text-[#4A7C59] hover:bg-[#ECFDF5]"}`}
                      >
                        <Power className="size-3" /> {t.is_active ? "停用" : "啟用"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">還沒有任何班別</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <NextStepHint tone="muted">
        班別不能刪,只能停用 — 舊班表還指著它。停用後排班時選不到,已排的照舊顯示。
      </NextStepHint>

      {editing && (
        <TemplateModal
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function TemplateModal({
  template,
  onClose,
  onSaved,
}: {
  template: ShiftTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [shortName, setShortName] = useState(template?.short_name ?? "");
  const [startTime, setStartTime] = useState(template?.start_time ?? "08:00");
  const [endTime, setEndTime] = useState(template?.end_time ?? "17:00");
  const [breakMinutes, setBreakMinutes] = useState(String(template?.break_minutes ?? 60));
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  const minutes = startTime && endTime ? shiftDurationMinutes(startTime, endTime, Number(breakMinutes) || 0) : 0;

  function save() {
    startTransition(async () => {
      const res = await saveShiftTemplateAction({
        id: template?.id,
        name,
        shortName,
        startTime,
        endTime,
        breakMinutes: Number(breakMinutes),
      });
      if (res.ok) {
        toast.success(template ? "已更新班別" : "已新增班別");
        onSaved();
      } else {
        setErrors(res.fieldErrors);
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg border border-[#E0DCD6] bg-card shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#E0DCD6] px-5 py-3">
          <h2 className="text-base font-semibold text-primary">{template ? `編輯：${template.name}` : "新增班別"}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-[#F5F1EC] hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <div>
              <Label htmlFor="tpl-name">名稱</Label>
              <Input id="tpl-name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="例:日班、早班、晚班" className="mt-1 h-10 md:h-10" />
              {errors?.name && <p className="mt-1 text-xs text-[#B91C1C]">{errors.name[0]}</p>}
            </div>
            <div>
              <Label htmlFor="tpl-short">短名</Label>
              <Input id="tpl-short" value={shortName} maxLength={2} onChange={(e) => setShortName(e.target.value)} placeholder="日" className="mt-1 h-10 text-center md:h-10" />
              {errors?.shortName && <p className="mt-1 text-xs text-[#B91C1C]">{errors.shortName[0]}</p>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="tpl-start">上班</Label>
              <Input id="tpl-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1 h-10 md:h-10" />
            </div>
            <div>
              <Label htmlFor="tpl-end">下班</Label>
              <Input id="tpl-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="mt-1 h-10 md:h-10" />
              {errors?.endTime && <p className="mt-1 text-xs text-[#B91C1C]">{errors.endTime[0]}</p>}
            </div>
            <div>
              <Label htmlFor="tpl-break">休息（分）</Label>
              <Input id="tpl-break" type="number" min={0} max={240} step={5} value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} className="mt-1 h-10 md:h-10" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            工時 {(minutes / 60).toFixed(1).replace(/\.0$/, "")} 小時
            {startTime && endTime && crossesMidnight(startTime, endTime) ? "(跨日)" : ""}
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="button" onClick={save} disabled={isPending || !name.trim() || !shortName.trim() || !startTime || !endTime}>
              {isPending ? "儲存中…" : "儲存"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
