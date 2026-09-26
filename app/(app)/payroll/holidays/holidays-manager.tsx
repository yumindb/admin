"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isoWeekday, type Holiday } from "@/lib/payroll/holidays";
import { WEEKDAY_LABEL } from "@/lib/payroll/settings";
import { deleteHolidayAction, saveHolidayAction } from "../actions";

export function HolidaysManager({
  year,
  thisYear,
  rows,
}: {
  year: number;
  thisYear: number;
  rows: Holiday[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState(`${year}-`);
  const [name, setName] = useState("");
  const [isWorkday, setIsWorkday] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const years = Array.from(new Set([thisYear - 1, thisYear, thisYear + 1, year])).sort();

  function add() {
    startTransition(async () => {
      const res = await saveHolidayAction({ date: date.trim(), name: name.trim(), isWorkday });
      if (res.ok) {
        toast.success(`已加入 ${date}`);
        setName("");
        setIsWorkday(false);
        setDate(`${year}-`);
        router.refresh();
      } else {
        toast.error(res.fieldErrors?.date?.[0] ?? res.fieldErrors?.name?.[0] ?? res.error);
      }
    });
  }

  function remove(d: string) {
    setConfirmDelete(null);
    startTransition(async () => {
      const res = await deleteHolidayAction({ date: d });
      if (res.ok) {
        toast.success(`已移除 ${d}`);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const offDays = rows.filter((r) => !r.is_workday).length;
  const workDays = rows.length - offDays;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {years.map((y) => (
          <Link
            key={y}
            href={`/payroll/holidays?year=${y}`}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
              y === year
                ? "border-primary bg-primary text-primary-foreground"
                : "border-[#E0DCD6] bg-white text-foreground hover:border-accent hover:text-accent"
            }`}
          >
            {y} 年
          </Link>
        ))}
        <span className="ml-auto text-sm text-muted-foreground">
          放假 {offDays} 天{workDays > 0 ? `・補班 ${workDays} 天` : ""}
        </span>
      </div>

      <div className="overflow-hidden rounded-md border border-[#E0DCD6] bg-card">
        <table className="w-full text-sm">
          <thead className="bg-[#F5F1EC]/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">日期</th>
              <th className="px-4 py-2.5 font-medium">星期</th>
              <th className="px-4 py-2.5 font-medium">名稱</th>
              <th className="px-4 py-2.5 font-medium">類型</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EBE4]">
            {rows.map((r) => (
              <tr key={r.holiday_date} className="hover:bg-[#F5F1EC]/40">
                <td className="px-4 py-2.5 font-mono text-foreground">{r.holiday_date}</td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {WEEKDAY_LABEL[isoWeekday(r.holiday_date)]}
                </td>
                <td className="px-4 py-2.5 text-foreground">{r.name}</td>
                <td className="px-4 py-2.5">
                  {r.is_workday ? (
                    <span className="inline-flex rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 text-xs text-[#92400E]">
                      補班日
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-2 py-0.5 text-xs text-[#4A7C59]">
                      放假
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {confirmDelete === r.holiday_date ? (
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => remove(r.holiday_date)}
                        disabled={isPending}
                        className="rounded-md border border-[#FCA5A5] bg-white px-2 py-1 text-xs text-[#B91C1C] hover:bg-[#FEF2F2] disabled:opacity-50"
                      >
                        確定移除
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="rounded-md border border-[#E0DCD6] bg-white px-2 py-1 text-xs text-foreground"
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(r.holiday_date)}
                      title="移除"
                      className="inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-white px-2 py-1 text-xs text-foreground hover:border-[#FCA5A5] hover:text-[#B91C1C]"
                    >
                      <Trash2 className="size-3" /> 移除
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  {year} 年還沒有任何假日,從下面加。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-md border border-[#E0DCD6] bg-card px-5 py-4">
        <h2 className="mb-3 text-base font-semibold text-primary">新增一天</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[10rem_1fr_auto] md:items-end">
          <div>
            <Label htmlFor="holiday-date">日期</Label>
            <Input
              id="holiday-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 h-10 md:h-10"
            />
          </div>
          <div>
            <Label htmlFor="holiday-name">名稱</Label>
            <Input
              id="holiday-name"
              value={name}
              placeholder="例:端午節、國慶日補假"
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 h-10 md:h-10"
            />
          </div>
          <Button type="button" onClick={add} disabled={isPending || !name.trim() || date.length !== 10}>
            <Plus className="size-4" /> 加入
          </Button>
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isWorkday}
            onChange={(e) => setIsWorkday(e.target.checked)}
            className="size-4 accent-[#003153]"
          />
          這天是補班日(週六日要上班,當平日算)
        </label>
        <p className="mt-2 text-xs text-muted-foreground">同一天再填一次會直接覆蓋名稱與類型。</p>
      </div>
    </div>
  );
}
