"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { evaluateGeofence } from "@/lib/geo";
import { FIELD_LABEL, stableStringify } from "@/lib/log-diff";
import { extractStoragePath, normalizePhotoPaths } from "@/lib/supabase/storage";

const PHOTO_BUCKET = "daily-photos";
const SIGNATURE_BUCKET = "signatures";
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
  photos: LogPhoto[];    // 每張帶 path + caption（caption 可為空字串）
  vendorNotices: string;
  notes: string;
  intent: "draft" | "submit" | "post_edit";
  fillSignatureUrl?: string;  // submit 時必帶 — 填表人手寫簽名；post_edit 不需要
  mergedReportIds?: string[]; // 整合的現場回報 ids，送出時翻 merged
  editReason?: string;        // post_edit 用，目前 UI 暫不收集，預留欄位
  submitLocation?: SubmitLocationInput | null;  // 送出時的位置（可選；client 沒授權時為 null）
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
      return { ok: false, error: "您的角色無法編輯日誌" };
    }
    if (!payload.logId) {
      return { ok: false, error: "缺少 logId" };
    }
  }

  // client 傳來的 photos[].path 是上傳 action 回的 signed URL(要即時預覽用),
  // 進 DB 前一律收斂成 storage path — 見 normalizePhotoPaths 的說明。
  const photos = normalizePhotoPaths(payload.photos, PHOTO_BUCKET);
  // 填表人簽名同理:uploadSignatureAction / stampSignatureAction 回的是 signed URL
  const fillSignaturePath = payload.fillSignatureUrl
    ? extractStoragePath(payload.fillSignatureUrl, SIGNATURE_BUCKET)
    : undefined;

  if (!payload.caseId) return { ok: false, error: "請選案件" };
  if (!payload.logDate) return { ok: false, error: "請選日期" };
  const hasContent =
    payload.workItems.length > 0 ||
    payload.extraItems.length > 0 ||
    payload.unsignedItems.length > 0;
  if (payload.intent === "submit" && !hasContent) {
    return {
      ok: false,
      error: "送出前至少要填 1 個工項（主工項 / 合約外 / 未簽約 任一）",
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
      photos,
      vendor_notices: payload.vendorNotices || null,
      notes: payload.notes || null,
    };

    // 比對「有沒有真的改」時,舊快照的照片也要先正規化 — 否則 2026-08 之前
    // 存成 signed URL 的日誌,第一次被編輯就會誤報「照片改過」(其實只是換寫法)。
    const snapshotForCompare: Record<string, unknown> = {
      ...snapshot,
      photos: normalizePhotoPaths(snapshot.photos, PHOTO_BUCKET),
    };

    // ⚠ 一定要用 stableStringify:snapshot 是從 jsonb 讀回來的(key 被 Postgres
    // 重排過),next 是 client 傳來的原始順序。直接 JSON.stringify 比會把
    // 「內容一樣、key 順序不同」判成有變 → changed_fields 塞一堆沒改的欄位,
    // 詳情頁的前後對照就會出現算不出差異的空欄位。
    const changed: DailyLogEditableField[] = [];
    for (const k of EDITABLE_FIELDS) {
      const before = stableStringify(snapshotForCompare[k] ?? null);
      const after = stableStringify(
        (next as Record<string, unknown>)[k] ?? null
      );
      if (before !== after) changed.push(k);
    }

    // 已退回的日誌:這次存檔本身就是「修正完畢、重新送出」,即使內容沒動也要送回
    // 簽核流程(2026-08 業主回報:助理改完退回的日誌只能存檔,沒有任何重送入口)。
    const resubmitFromRejected = existing.status === "rejected";

    if (changed.length === 0 && !resubmitFromRejected) {
      // 沒有改動就直接放行,不寫 revision
      return { ok: true, logId, unchanged: true };
    }

    // 先寫 revision,再 update。失敗就 reject 整個操作。
    // 內容完全沒動的重送不留 revision(沒有前後對照可看),只做狀態轉移。
    if (changed.length > 0) {
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
        return { ok: false, error: "寫入編輯紀錄失敗：" + revErr.message };
      }
    }

    // 簽核階段重設規則(post_edit 時依角色決定退回到哪一關):
    //   - submitted + 主任 改 → 一律退到 audit(助理重審 → 老闆重看)
    //   - submitted + 助理 改 + current_stage='approve' → 退到 audit
    //     (老闆原本要核定的版本被助理改了,要先讓助理自己重審才上老闆)
    //   - submitted + 助理 改 + current_stage='audit' → 不變(助理在自己關卡內修正)
    //   - submitted + 主任 改 + current_stage='review' → 退到 audit
    //     (主任改完不再卡自己關卡;直接讓助理看新版本)
    //   - rejected → 一律回到 submitted + audit 關(助理重審 → 再上核定人)
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
    } else if (resubmitFromRejected) {
      nextStage = "audit";
    }
    const stageChanged = nextStage !== existingStage;

    // status guard: 只在「我們讀到」當下的 status 沒被別人改掉時才 update。
    // 防止讀 → 別人 approve / reject → 我寫覆蓋掉的競態。
    const expectedStatus = existing.status as string;
    const updatePayload: Record<string, unknown> = { ...next };
    if (stageChanged) updatePayload.current_stage = nextStage;
    // 重送:submitted_at 要更新 — 雙簽的「本輪已簽人數」是用
    // log_approvals.created_at >= daily_logs.submitted_at 判定的,不更新會把
    // 退回前那一輪的核定簽名算進這一輪。
    const resubmittedAt = resubmitFromRejected ? new Date().toISOString() : null;
    if (resubmitFromRejected) {
      updatePayload.status = "submitted";
      updatePayload.submitted_at = resubmittedAt;
    }
    const { data: updRows, error: updErr } = await supabase
      .from("daily_logs")
      .update(updatePayload)
      .eq("id", logId)
      .eq("status", expectedStatus)
      .select("id");
    if (updErr) {
      return { ok: false, error: "儲存失敗：" + updErr.message };
    }
    if (!updRows || updRows.length === 0) {
      return {
        ok: false,
        error: "日誌狀態已被他人變更（可能剛被核定 / 退回），請重新整理",
      };
    }

    if (resubmitFromRejected) {
      // 重送 → 核定簽名計數歸零(上一輪的簽名不算數)。
      // 獨立語句 + 忽略錯誤:migration-2.29 未跑時不影響重送本身。
      await supabase
        .from("daily_logs")
        .update({ approve_signatures: 0 })
        .eq("id", logId);

      // 通知辦公室助理有退件修正完、重新進 audit 關。
      // 放在 after():不阻塞 response,通知失敗也不影響日誌本身。
      const notifyLogId = logId;
      after(async () => {
        const { notifyLogResubmitted } = await import("@/lib/notifications/events");
        await notifyLogResubmitted(notifyLogId);
      });
    }

    // 站內消息:日誌被改了,主任與前面關卡經手過的人都該知道(2026-08-04 業主追加)。
    // 以前只有畫面上一個「經助理修改」標籤 — 要人自己點進去才看得到。
    // 重送的情況多通知全部辦公室助理(這份會回到他們的待審核清單)。
    const editorId = user.id;
    const changedLabels = changed.map((f) => FIELD_LABEL[f] ?? f);
    const editedLogId = logId;
    const wasResubmit = resubmitFromRejected;
    after(async () => {
      const { messageLogEdited } = await import("@/lib/notifications/events");
      await messageLogEdited(editedLogId, editorId, changedLabels, {
        resubmitted: wasResubmit,
      });
    });

    revalidatePath("/logs");
    revalidatePath(`/logs/${logId}`);
    revalidatePath("/approvals");
    return {
      ok: true,
      logId,
      stageReset: stageChanged ? nextStage : null,
      resubmitted: resubmitFromRejected,
    };
  }

  // ============================================================
  // draft / submit 分支(原邏輯)
  // ============================================================
  // 三關流程:submit 時 status='submitted' + current_stage='audit'(辦公室審核)。
  // draft 時兩個欄位都 null。
  // 重送被退回的日誌(rejected → submit)同樣直接進 audit。
  // 若未來需要加回主任複核關,改這裡為 'review' 並恢復 NEXT_STAGE fill→review 即可。

  // 編輯既有日誌前先讀當前狀態:classic 編輯只准動 draft / rejected,而且
  // 「暫存」不可以把已退回的日誌打回 draft — 那會讓它從助理與核定人的清單整份
  // 消失、也不發任何通知(2026-08 業主回報的失蹤日誌就是這樣來的)。
  let existingStatus: string | null = null;
  if (payload.logId) {
    const { data: existingRow } = await supabase
      .from("daily_logs")
      .select("status")
      .eq("id", payload.logId)
      .maybeSingle();
    if (!existingRow) return { ok: false, error: "找不到日誌" };
    existingStatus = existingRow.status as string;
    if (existingStatus !== "draft" && existingStatus !== "rejected") {
      return {
        ok: false,
        error: "這份日誌已在簽核流程中，請用「儲存編輯」而不是重新送出",
      };
    }
  }

  const status =
    payload.intent === "submit"
      ? "submitted"
      : existingStatus === "rejected"
        ? "rejected"   // 已退回的日誌暫存 → 維持已退回,不降級成草稿
        : "draft";
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
      photos,
      vendor_notices: payload.vendorNotices || null,
      notes: payload.notes || null,
      status,
      current_stage: currentStage,
    };
    if (submittedAt) updatePayload.submitted_at = submittedAt;
    if (submitLocFields) Object.assign(updatePayload, submitLocFields);

    // ⚠ 一定要看 rowcount:`.eq("supervisor_id", user.id)` 或 RLS 擋下來時,
    // PostgREST 回的是「0 筆更新、沒有 error」。只看 error 會回報送出成功但
    // 資料庫完全沒動 — 使用者以為送出了、審核端永遠收不到。
    const { data: updRows, error } = await supabase
      .from("daily_logs")
      .update(updatePayload)
      .eq("id", logId)
      .eq("supervisor_id", user.id)
      .select("id");
    if (error) return { ok: false, error: "儲存失敗：" + error.message };
    if (!updRows || updRows.length === 0) {
      return {
        ok: false,
        error: "沒有權限修改這份日誌（只有填表的工地主任本人可以重新送出）",
      };
    }

    // 重送 → 核定簽名計數歸零(雙簽制:上一輪的簽名不算數)。
    // 獨立語句 + 忽略錯誤:migration-2.29 未跑時不影響送出。
    if (submittedAt) {
      await supabase
        .from("daily_logs")
        .update({ approve_signatures: 0 })
        .eq("id", logId);
    }
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
      photos,
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
    if (error || !data) return { ok: false, error: "建立失敗：" + error?.message };
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
      signature_url: fillSignaturePath,
    });
    if (sigErr) return { ok: false, error: "簽名儲存失敗：" + sigErr.message };
  }

  // 送出成功(首次或重送)→ LINE 通知辦公室助理有日誌進 audit 關。
  // 放在 after():不阻塞 response,通知失敗也不影響日誌本身。
  if (payload.intent === "submit" && logId) {
    const notifyLogId = logId;
    // 站內消息只發「重送」— 首次送出靠導覽列的「待審核」紅字就夠了,
    // 每天每份日誌都發一則消息只會把真正要看的意見洗掉
    // (業主拍板的原則:有話要說才發消息)。
    const isResubmit = existingStatus === "rejected";
    const editorId = user.id;
    after(async () => {
      const { notifyLogSubmitted, messageLogEdited } = await import(
        "@/lib/notifications/events"
      );
      if (isResubmit) {
        // classic 重送算不出前後差異(這條路徑沒寫 revision)→ 傳 null
        await messageLogEdited(notifyLogId, editorId, null, {
          resubmitted: true,
        });
      }
      await notifyLogSubmitted(notifyLogId);
    });
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
        warning: "日誌已存，但讀取現場回報狀態失敗:" + readErr.message,
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
        warning: `日誌已存，但 ${conflicts.length} 筆現場回報已被他人整合或封存，未重複合併`,
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
          warning: "日誌已存，但部分現場回報狀態更新失敗:" + mergeErr.message,
        };
      }
      if ((updRows?.length ?? 0) < idsToMerge.length) {
        // 最後一刻被別人搶走 — 已存的不退,只 warn
        return {
          ok: true,
          logId,
          warning: `日誌已存，但部分現場回報在合併瞬間被他人搶先處理`,
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
