"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCaseAction, type NewCaseState } from "./actions";

export function NewCaseForm() {
  const [state, formAction, pending] = useActionState<NewCaseState, FormData>(
    createCaseAction,
    undefined
  );

  return (
    <form action={formAction} className="space-y-5">
      <Field label="案件名稱 *" htmlFor="name" error={state?.fieldErrors?.name?.[0]}>
        <Input id="name" name="name" required placeholder="清華大學月涵堂遷修工程" />
      </Field>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field label="案件編號" htmlFor="code">
          <Input id="code" name="code" placeholder="例：YM-2026-001" />
        </Field>
        <Field label="開工日期" htmlFor="started_at">
          <Input id="started_at" name="started_at" type="date" />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field label="施工地點" htmlFor="location">
          <Input id="location" name="location" placeholder="臺北市金華街" />
        </Field>
        <Field label="業主／發包單位" htmlFor="client">
          <Input id="client" name="client" placeholder="清華大學" />
        </Field>
      </div>

      <Field label="備註" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={3}
          className="flex w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-sm text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
      </Field>

      {state?.error && (
        <p className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        <Button asChild variant="ghost" type="button">
          <Link href="/">取消</Link>
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
