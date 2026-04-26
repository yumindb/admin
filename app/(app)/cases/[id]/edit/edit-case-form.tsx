"use client";

import { CaseForm, type CaseFormDefaults, type CaseFormState } from "@/components/case-form";
import { updateCaseAction } from "./actions";

export function EditCaseForm({
  caseId,
  defaults,
}: {
  caseId: string;
  defaults: CaseFormDefaults;
}) {
  const wrapped = async (
    state: CaseFormState,
    formData: FormData
  ): Promise<CaseFormState> => {
    formData.set("caseId", caseId);
    return updateCaseAction(state, formData);
  };
  return (
    <CaseForm
      action={wrapped}
      defaults={defaults}
      mode="edit"
      cancelHref={`/cases/${caseId}`}
    />
  );
}
