import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetActor } from "@/lib/auth/require-role";
import { NextStepHint } from "@/components/next-step-hint";
import { ROLE_LABEL, canApplyLeave, getApprovalChain } from "@/lib/leave";
import { LeaveRequestForm } from "./leave-request-form";

export const dynamic = "force-dynamic";

export default async function NewLeavePage() {
  const me = await tryGetActor();
  if (!me) redirect("/login");
  if (!canApplyLeave(me.role)) {
    // owner 不能送 — 引導回列表
    redirect("/leaves");
  }
  const chain = getApprovalChain(me.role);

  return (
    <div className="mx-auto max-w-2xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/leaves" className="hover:text-accent">
          請假
        </Link>
        <span className="mx-1.5">／</span>
        <span>新請假</span>
      </nav>

      <h1 className="mb-2 text-2xl font-semibold text-primary md:text-3xl">
        新請假
      </h1>
      <p className="mb-5 text-base text-muted-foreground">
        填完按送出,系統會自動依層級往上送簽。
      </p>

      <div className="mb-5">
        <NextStepHint tone="info" title="簽核流程">
          這份申請會送到:
          {chain.map((r, i) => (
            <span key={r}>
              {i > 0 && " → "}
              <span className="font-medium text-foreground">
                {ROLE_LABEL[r]}
              </span>
            </span>
          ))}
          。 每一關都通過才算核准;任一關退回,整份申請會結束(可重送新的一份)。
        </NextStepHint>
      </div>

      <LeaveRequestForm />
    </div>
  );
}
