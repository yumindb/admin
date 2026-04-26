"use client";

import { CaseForm } from "@/components/case-form";
import { createCaseAction } from "./actions";

export function NewCaseForm() {
  return <CaseForm action={createCaseAction} mode="create" cancelHref="/" />;
}
