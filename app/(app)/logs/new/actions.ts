"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { evaluateGeofence } from "@/lib/geo";
import type {
  ApprovalStage,
  DailyLogManpower,
  DailyLogWorkItem,
  DailyLogExtraItem,
  DailyLogUnsignedItem,
  DailyLogEditableField,
  DailyLogSnapshot,
  LogPhoto,
  UserRole,
} from "@/lib/types";

/** 隱式 GPS 戳記(migration-2.22)— 送出時 client 帶過來,僅在「首次送出」寫入 */
export type SubmitLocationInput = {
  lat: number;
  lng: number;
  accuracy_m: number | null;
};

type SaveLogPayload = {
  logId?: string;        // 編輯時帶
  caseId: string;
  logDate: string;
  weather: string;
  manpower: DailyLogManpower;
  workItems: DailyLogWorkItem[];
  extraItems: DailyLogExtraItem[];
  unsignedItems: DailyLogUnsignedItem[];
  photos: LogPhoto[];    // 每張帶 path + caption(caption 可為空字串)
  vendorNotices: string;
  notes: string;
  intent: "draft" | "submit" | "post_edit";
  fillSignatureUrl?: string;  // submit 時必帶 — 填表人手寫簽名;post_edit 不需要
  mergedReportIds?: string[]; // 整合的現場回報 ids,送出時翻 merged
  editReason?: string;        // post_edit 用,目前 UI 暫不收集,預留欄位
  submitLocation?: SubmitLocationInput | null;  // 送出時的位置(可選;client 沒授權時為 null)
};

const EDITABLE_FIELDS: DailyLogEditableField[] = [
  "log_date",
  "weather",
  "manpower",
  "work_items",
  "extra_items",
  "unsigned_items",
  "photos",
  "vendor_notices",
  "notes",
];

export async function saveLogAction(payload: SaveLogPayload) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登入" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = (profile?.role ?? null) as UserRole | null;

  // ----- 角色守則 -----
  // draft / submit:工地主任、老闆(原本就有,owner 為了測試流程也保留)
  // post_edit:    工地主任本人、辦公室助理、老闆
  if (payload.intent === "draft" || payload.intent === "submit") {
    if (role !== "site_supervisor" && role !== "owner") {
      return { ok: false, error: "只有工地主任或老闆可以填寫日誌" };
    }
  } else if (payload.intent === "post_edit") {
    if (
      role !== "site_supervisor" &&
      role !== "office_staff" &&
      role !== "owner"
    ) {
      return { ok: false, error: "你的角色無法編輯日誌" };
    }
    if (!payload.logId) {
      return { ok: false, error: "缺少 logId" };
    }
  }

  if (!payload.caseId) return { ok: false, error: "請選案件" };
  if (!payload.logDate) return { ok: false, error: "請選日期" };
  const hasContent =
    payload.workItems.length > 0 ||
    payload.extraItems.length > 0 ||
    payload.unsignedItems.length > 0;
  if (payload.intent === "submit" && !hasContent) {
    return {
      ok: false,
      error: "送出前至少要填 1 個工項(主工項 / 合約外 / 未簽約 任一)",
    };
  }
  if (payload.intent === "submit" && !payload.fillSignatureUrl) {
    return { ok: false, error: "送出前請先簽名" };
  }

  // ============================================================
  // post_edit 分支:送出後的編輯,寫 audit + 更新欄位,不動 status
  // ============================================================
  if (payload.intent === "post_edit") {
    const logId = payload.logId!;
    const { data: existing, error: loadErr } = await supabase
      .from("daily_logs")
      .select(
        "id, supervisor_id, status, current_stage, log_date, weather, manpower, work_items, extra_items, unsigned_items, photos, vendor_notices, notes"
      )
      .eq("id", logId)
      .maybeSingle();
    if (loadErr || !existing) return { ok: false, error: "找不到日誌" };

    if (existing.status === "approved") {
      return { ok: false, error: "已核定的日誌不可編輯" };
    }
    if (existing.status === "draft") {
      return { ok: false, error: "草稿請從草稿編輯流程進入" };
    }
    // submitted 或 rejected 才允許 post_edit。
    // site_supervisor 只能編輯自己掛名的日誌;office_staff / owner 不限。
    if (
      role === "site_supervisor" &&
      existing.supervisor_id !== user.id
    ) {
      return { ok: false, error: "只有此日誌的工地主任本人或助理 / 老闆可以編輯" };
    }

    const snapshot: DailyLogSnapshot = {
      log_date: existing.log_date as string,
      weather: (existing.weather as string | null) ?? null,
      manpower: (existing.manpower as DailyLogManpower) ?? {},
      work_items: (existing.work_items as DailyLogWorkItem[]) ?? [],
      extra_items: (existing.extra_items as DailyLogExtraItem[]) ?? [],
      unsigned_items:
        (existing.unsigned_items as DailyLogUnsignedItem[]) ?? [],
      photos: (existing.photos as LogPhoto[]) ?? [],
      vendor_notices: (existing.vendor_notices as string | null) ?? null,
      notes: (existing.notes as string | null) ?? null,
    };

    const next = {
      log_date: payload.logDate,
      weather: payload.weather || null,
      manpower: payload.manpower,
      work_items: payload.workItems,
      extra_items: payload.extraItems,
      unsigned_items: payload.unsignedItems,
      photos: payload.photos,
      vendor_notices: payload.vendorNotices || null,
      notes: payload.notes || null,
    };

    const changed: DailyLogEditableField[] = [];
    for (const k of EDITABLE_FIELDS) {
      const before = JSON.stringify(snapshot[k] ?? null);
      const after = JSON.stringify(
        (next as Record<string, unknown>)[k] ?? null
      );
      if (before !== after) changed.push(k);
    }

    if (changed.length === 0) {
      // 沒有改動就直接放行,不寫 revision
      return { ok: true, logId, unchanged: true };
    }

    // 先寫 revision,再 update。失敗就 reject 整個操作。
    const { error: revErr } = await supabase
      .from("daily_log_revisions")
      .insert({
        log_id: logId,
        editor_id: user.id,
        editor_role: role,
        log_status_at_edit: existing.status,
        snapshot,
        changed_fields: changed,
        reason: payload.editReason?.trim() || null,
      });
    if (revErr) {
      return { ok: false, error: "寫入編輯紀錄失敗:" + revErr.message };
    }

    // 簽核階段重設規則(post_edit 時依角色決定退回到哪一關):
    //   - submitted + 主任 改 → 一律退到 audit(助理重審 → 老闆重看)
    //   - submitted + 助理 改 + current_stage='approve' → 退到 audit
    //     (老闆原本要核定的版本被助理改了,要先讓助理自己重審才上老闆)
    //   - submitted + 助理 改 + current_stage='audit' → 不變(助理在自己關卡內修正)
    //   - submitted + 主任 改 + current_stage='review' → 退到 audit
    //     (主任改完不再卡自己關卡;直接讓助理看新版本)
    //   - rejected → current_stage 仍是 null,不變(主任後續再走 classic 重送)
    //   - 老闆 改 → 已被 status='approved' 阻擋進不來
    const existingStage =
      (existing.current_stage as ApprovalStage | null) ?? null;
    let nextStage: ApprovalStage | null = existingStage;
    if (existing.status === "submitted") {
      if (role === "site_supervisor") {
        nextStage = "audit";
      } else if (role === "office_staff" && existingStage === "approve") {
        nextStage = "audit";
      }
    }
    const stageChanged = nextStage !== existingStage;

    // status guard: 只在「我們讀到」當下的 status 沒被別人改掉時才 update。
    // 防止讀 → 別人 approve / reject → 我寫覆蓋掉的競態。
    const expectedStatus = existing.status as string;
    const updatePayload: Record<string, unknown> = { ...next };
    if (stageChanged) updatePayload.current_stage = nextStage;
    const { data: updRows, error: updErr } = await supabase
      .from("daily_logs")
      .update(updatePayload)
      .eq("id", logId)
      .eq("status", expectedStatus)
      .select("id");
    if (updErr) {
      return { ok: false, error: "儲存失敗:" + updErr.message };
    }
    if (!updRows || updRows.length === 0) {
      return {
        ok: false,
        error: "日誌狀態已被他人變更(可能剛被核定 / 退回),請重新整理",
      };
    }

    revalidatePath("/logs");
    revalidatePath(`/logs/${logId}`);
    revalidatePath("/approvals");
    return { ok: true, logId, stageReset: stageChanged ? nextStage : null };
  }

  // ============================================================
  // draft / submit 分支(原邏輯)
  // ============================================================
  // 三關流程:submit 時 status='submitted' + current_stage='audit'(辦公室審核)。
  // draft 時兩個欄位都 null。
  // 重送被退回的日誌(rejected → submit)同樣直接進 audit。
  // 若未來需要加回主任複核關,改這裡為 'review' 並恢復 NEXT_STAGE fill→review 即可。
  const status = payload.intent === "submit" ? "submitted" : "draft";
  const currentStage = payload.intent === "submit" ? "audit" : null;
  const submittedAt = payload.intent === "submit" ? new Date().toISOString() : null;

  // 隱式 GPS 戳記:只在「首次送出」時計算並寫入。
  // - draft → submit:寫
  // - rejected → submit(重送):也寫(視為一次新的送出)
  // - draft 持續存草稿:不寫
  // - post_edit:在上方 post_edit 分支處理,完全不動 submit_* 欄位
  let submitLocFields: {
    submit_lat: number | null;
    submit_lng: number | null;
    submit_accuracy_m: number | null;
    submit_distance_m: number | null;
    submit_within_geofence: boolean | null;
  } | null = null;

  if (payload.intent === "submit" && payload.submitLocation) {
    const loc = payload.submitLocation;
    // 撈案件座標算距離
    const { data: caseRow } = await supabase
      .from("cases")
      .select("lat, lng, geofence_radius_m")
      .eq("id", payload.caseId)
      .maybeSingle();
    const evald = evaluateGeofence(
      {
        lat: (caseRow?.lat as number | null) ?? null,
        lng: (caseRow?.lng as number | null) ?? null,
        geofence_radius_m: (caseRow?.geofence_radius_m as number) ?? 200,
      },
      { lat: loc.lat, lng: loc.lng },
    );
    submitLocFields = {
      submit_lat: loc.lat,
      submit_lng: loc.lng,
      submit_accuracy_m: loc.accuracy_m,
      submit_distance_m: evald.distanceM,
      submit_within_geofence: evald.withinGeofence,
    };
  }

  let logId = payload.logId;

  if (logId) {
    // 更新既有
    const updatePayload: Record<string, unknown> = {
      case_id: payload.caseId,
      log_date: payload.logDate,
      weather: payload.weather || null,
      manpower: payload.manpower,
      work_items: payload.workItems,
      extra_items: payload.extraItems,
      unsigned_items: payload.unsignedItems,
      photos: payload.photos,
      vendor_notices: payload.vendorNotices || null,
      notes: payload.notes || null,
      status,
      current_stage: currentStage,
    };
    if (submittedAt) updatePayload.submitted_at = submittedAt;
    if (submitLocFields) Object.assign(updatePayload, submitLocFields);

    const { error } = await supabase
      .from("daily_logs")
      .update(updatePayload)
      .eq("id", logId)
      .eq("supervisor_id", user.id);
    if (error) return { ok: false, error: "儲存失敗:" + error.message };
  } else {
    const insertPayload: Record<string, unknown> = {
      case_id: payload.caseId,
      supervisor_id: user.id,
      log_date: payload.logDate,
      weather: payload.weather || null,
      manpower: payload.manpower,
      work_items: payload.workItems,
      extra_items: payload.extraItems,
      unsigned_items: payload.unsignedItems,
      photos: payload.photos,
      vendor_notices: payload.vendorNotices || null,
      notes: payload.notes || null,
      status,
      current_stage: currentStage,
      submitted_at: submittedAt,
    };
    if (submitLocFields) Object.assign(insertPayload, submitLocFields);

    const { data, error } = await supabase
      .from("daily_logs")
      .insert(insertPayload)
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "建立失敗:" + error?.message };
    logId = data.id;
  }

  // ⚠ Phase 2.3 起取消 auto-pass。三關都要對應角色的人手動點通過。
  // Phase 2.5:送出時填表人也要簽名 → 寫一筆 stage='fill' 的 log_approvals 紀錄,
  // 跟其他三關一致地進入 PDF 簽核紀錄區。重送被退回的日誌也會再寫一筆。
  if (payload.intent === "submit" && payload.fillSignatureUrl && logId) {
    const { error: sigErr } = await supabase.from("log_approvals").insert({
      log_id: logId,
      stage: "fill",
      approver_id: user.id,
      decision: "approved",
      signature_url: payload.fillSignatureUrl,
    });
    if (sigErr) return { ok: false, error: "簽名儲存失敗:" + sigErr.message };
  }

  // 把整合進來的現場回報翻成 merged。
  //
  // Idempotency / race condition:
  //   1. 先讀回每筆 report 當前 status。
  //   2. 若已 merged_into_log_id === 此 logId → 視為已合併,略過(idempotent retry)。
  //   3. 若 status !== 'pending' 但不是合併到自己 → 直接 abort 並回 warning,
  //      不做任何 update(避免「主任 A 整合一半、主任 B 也選同一筆」的混亂)。
  //   4. 用 `.eq("status","pending")` 條件式 update,select 回 row 數確認實際翻幾筆。
  //
  // 註: Supabase JS 沒有 transaction API。這仍非真正 atomic,但兩階段 + conditional
  //      update 已可擋住絕大部分 UI race。徹底解只能寫 RPC,留待 Phase 2。
  if (payload.mergedReportIds && payload.mergedReportIds.length > 0 && logId) {
    const { data: currentReports, error: readErr } = await supabase
      .from("field_reports")
      .select("id, status, merged_into_log_id")
      .in("id", payload.mergedReportIds);
    if (readErr) {
      return {
        ok: true,
        logId,
        warning: "日誌已存,但讀取現場回報狀態失敗:" + readErr.message,
      };
    }

    const idsToMerge: string[] = [];
    const alreadyMergedToSelf: string[] = [];
    const conflicts: string[] = [];
    for (const r of currentReports ?? []) {
      const id = r.id as string;
      const status = r.status as string;
      const mergedTo = r.merged_into_log_id as string | null;
      if (status === "merged" && mergedTo === logId) {
        alreadyMergedToSelf.push(id);
      } else if (status === "pending") {
        idsToMerge.push(id);
      } else {
        conflicts.push(id);
      }
    }

    if (conflicts.length > 0) {
      return {
        ok: true,
        logId,
        warning: `日誌已存,但 ${conflicts.length} 筆現場回報已被他人整合或封存,未重複合併`,
      };
    }

    if (idsToMerge.length > 0) {
      const { data: updRows, error: mergeErr } = await supabase
        .from("field_reports")
        .update({
          status: "merged",
          merged_into_log_id: logId,
          merged_by: user.id,
          merged_at: new Date().toISOString(),
        })
        .in("id", idsToMerge)
        .eq("status", "pending")
        .select("id");
      if (mergeErr) {
        return {
          ok: true,
          logId,
          warning: "日誌已存,但部分現場回報狀態更新失敗:" + mergeErr.message,
        };
      }
      if ((updRows?.length ?? 0) < idsToMerge.length) {
        // 最後一刻被別人搶走 — 已存的不退,只 warn
        return {
          ok: true,
          logId,
          warning: `日誌已存,但部分現場回報在合併瞬間被他人搶先處理`,
        };
      }
    }

    revalidatePath("/field-reports");
    // alreadyMergedToSelf 是 idempotent 重試,不算錯誤,直接放行
  }

  revalidatePath("/logs");
  revalidatePath(`/logs/${logId}`);
  revalidatePath("/approvals");

  return { ok: true, logId };
}

export async function deleteLogAction(formData: FormData) {
  const logId = String(formData.get("logId") ?? "");
  if (!logId) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "site_supervisor" && profile?.role !== "owner") return;
  // 只能刪自己的草稿
  await supabase
    .from("daily_logs")
    .delete()
    .eq("id", logId)
    .eq("supervisor_id", user.id)
    .eq("status", "draft");
  revalidatePath("/logs");
  redirect("/logs");
}
