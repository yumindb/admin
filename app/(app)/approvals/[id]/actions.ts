"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function approveLogAction(payload: {
  logId: string;
  signatureUrl: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "未登入" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "owner") {
    return { ok: false as const, error: "只有老闆可以核定" };
  }

  if (!payload.signatureUrl) return { ok: false as const, error: "請先簽名" };

  await supabase.from("log_approvals").insert({
    log_id: payload.logId,
    stage: "approve",
    approver_id: user.id,
    decision: "approved",
    signature_url: payload.signatureUrl,
  });

  await supabase
    .from("daily_logs")
    .update({ status: "approved" })
    .eq("id", payload.logId);

  revalidatePath("/approvals");
  revalidatePath(`/logs/${payload.logId}`);
  return { ok: true as const };
}

export async function rejectLogAction(payload: {
  logId: string;
  comment: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "未登入" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "owner") {
    return { ok: false as const, error: "只有老闆可以退回" };
  }
  if (!payload.comment.trim())
    return { ok: false as const, error: "退回需要填原因" };

  await supabase.from("log_approvals").insert({
    log_id: payload.logId,
    stage: "approve",
    approver_id: user.id,
    decision: "rejected",
    comment: payload.comment.trim(),
  });

  await supabase
    .from("daily_logs")
    .update({ status: "rejected" })
    .eq("id", payload.logId);

  revalidatePath("/approvals");
  revalidatePath(`/logs/${payload.logId}`);
  return { ok: true as const };
}

export async function nextPendingRedirect(currentLogId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .maybeSingle();
  if (profile?.role !== "owner") redirect("/logs");
  const { data } = await supabase
    .from("daily_logs")
    .select("id")
    .eq("status", "submitted")
    .neq("id", currentLogId)
    .order("submitted_at", { ascending: true })
    .limit(1);
  if (data && data.length > 0) {
    redirect(`/approvals/${data[0].id}`);
  }
  redirect("/approvals");
}
