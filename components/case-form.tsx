"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type CaseFormState =
  | { error?: string; fieldErrors?: Record<string, string[]> }
  | undefined;

export type CaseFormDefaults = {
  name?: string | null;
  code?: string | null;
  location?: string | null;
  client?: string | null;
  started_at?: string | null;
  notes?: string | null;
};

type Props = {
  action: (state: CaseFormState, formData: FormData) => Promise<CaseFormState>;
  defaults?: CaseFormDefaults;
  mode: "create" | "edit";
  cancelHref: string;
};

export function CaseForm({ action, defaults = {}, mode, cancelHref }: Props) {
  const [state, formAction, pending] = useActionState<CaseFormState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="space-y-5">
      <Field label="案件名稱 *" htmlFor="name" error={state?.fieldErrors?.name?.[0]}>
        <Input
          id="name"
          name="name"
          required
          defaultValue={defaults.name ?? ""}
          placeholder="清華大學月涵堂遷修工程"
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field label="案件編號" htmlFor="code">
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
      </div>

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

      <Field label="備註" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={defaults.notes ?? ""}
          className="flex w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-sm text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
      </Field>

      {state?.error && (
        <p className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          {state.error}
        </p>
      )}

      {mode === "create" ? (
        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          <Button asChild variant="ghost" type="button">
            <Link href={cancelHref}>取消</Link>
          </Button>
          <Button
            type="submit"
            name="next"
            value="detail"
            disabled={pending}
            variant="outline"
            className="border-[#E0DCD6]"
          >
            {pending ? "建立中…" : "只建立案件"}
          </Button>
          <Button
            type="submit"
            name="next"
            value="import"
            disabled={pending}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {pending ? "建立中…" : "建立並匯入標單"}
          </Button>
        </div>
      ) : (
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
      )}
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
