"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { changePasswordAction, type ChangePasswordState } from "./actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function PasswordForm() {
  const [state, formAction] = useActionState<ChangePasswordState, FormData>(
    changePasswordAction,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message);
      formRef.current?.reset();
    } else {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">

      <div className="space-y-2">
        <Label htmlFor="current_password">目前密碼</Label>
        <Input
          id="current_password"
          name="current_password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="new_password">新密碼(至少 6 碼)</Label>
        <Input
          id="new_password"
          name="new_password"
          type="password"
          autoComplete="new-password"
          minLength={6}
          maxLength={72}
          required
          className="h-11"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm_password">再輸入一次新密碼</Label>
        <Input
          id="confirm_password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          minLength={6}
          maxLength={72}
          required
          className="h-11"
        />
      </div>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      className="bg-primary text-primary-foreground hover:bg-primary/90"
    >
      {pending ? "更新中…" : "更新密碼"}
    </Button>
  );
}
