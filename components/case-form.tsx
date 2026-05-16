"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COMPANIES, DEFAULT_COMPANY } from "@/lib/companies";
import { CaseLocationPicker } from "@/components/case-location-picker";

export type CaseFormState =
  | { error?: string; fieldErrors?: Record<string, string[]> }
  | undefined;

export type CaseFormDefaults = {
  name?: string | null;
  code?: string | null;
  company?: string | null;
  location?: string | null;
  client?: string | null;
  started_at?: string | null;
  expected_end?: string | null;
  notes?: string | null;
  // 工地座標 + geofence — 打卡功能用(migration-2.20)
  lat?: number | null;
  lng?: number | null;
  geofence_radius_m?: number | null;
};

/**
 * 純欄位元件 — 開新案／編輯共用。包在 <form> 內使用。
 * 不含 submit / cancel 按鈕、不含 useActionState；交由外層決定。
 */
export function CaseFormFields({
  defaults = {},
  fieldErrors,
}: {
  defaults?: CaseFormDefaults;
  fieldErrors?: Record<string, string[]>;
}) {
  return (
    <div className="space-y-5">
      <Field label="案件名稱 *" htmlFor="name" error={fieldErrors?.name?.[0]}>
        <Input
          id="name"
          name="name"
          required
          defaultValue={defaults.name ?? ""}
          placeholder="清華大學月涵堂遷修工程"
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <Field label="案件編號" htmlFor="code" error={fieldErrors?.code?.[0]}>
          <Input
            id="code"
            name="code"
            defaultValue={defaults.code ?? ""}
            placeholder="例:YM-2026-001"
          />
        </Field>
        <Field label="開工日期" htmlFor="started_at">
          <Input
            id="started_at"
            name="started_at"
            type="date"
            defaultValue={defaults.started_at ?? ""}
          />
        </Field>
        <Field
          label="預計完工日期"
          htmlFor="expected_end"
          error={fieldErrors?.expected_end?.[0]}
        >
          <Input
            id="expected_end"
            name="expected_end"
            type="date"
            defaultValue={defaults.expected_end ?? ""}
          />
        </Field>
      </div>

      <Field label="承接公司 *" htmlFor="company" error={fieldErrors?.company?.[0]}>
        <select
          id="company"
          name="company"
          required
          defaultValue={defaults.company ?? DEFAULT_COMPANY}
          className="flex h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-sm text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        >
          {COMPANIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field label="施工地點" htmlFor="location">
          <Input
            id="location"
            name="location"
            defaultValue={defaults.location ?? ""}
            placeholder="臺北市金華街"
          />
        </Field>
        <Field label="業主／發包單位" htmlFor="client">
          <Input
            id="client"
            name="client"
            defaultValue={defaults.client ?? ""}
            placeholder="清華大學"
          />
        </Field>
      </div>

      <CaseLocationPicker
        defaultLat={defaults.lat ?? null}
        defaultLng={defaults.lng ?? null}
        defaultRadius={defaults.geofence_radius_m ?? 200}
      />

      <Field label="備註" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={defaults.notes ?? ""}
          className="flex w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-sm text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
      </Field>
    </div>
  );
}

/**
 * 編輯模式用的簡單表單 — 一個提交按鈕、一個取消連結。
 */
export function CaseForm({
  action,
  defaults = {},
  cancelHref,
}: {
  action: (state: CaseFormState, formData: FormData) => Promise<CaseFormState>;
  defaults?: CaseFormDefaults;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<CaseFormState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="space-y-5">
      <CaseFormFields defaults={defaults} fieldErrors={state?.fieldErrors} />

      {state?.error && (
        <p className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          {state.error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button asChild variant="ghost" type="button">
          <Link href={cancelHref}>取消</Link>
        </Button>
        <Button
          type="submit"
          disabled={pending}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {pending ? "儲存中…" : "儲存變更"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-xs text-[#B91C1C]">{error}</p>}
    </div>
  );
}
