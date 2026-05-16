"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useGeolocation, accuracyLevel } from "@/lib/use-geolocation";
import {
  evaluateGeofence,
  formatDistance,
  googleMapsLink,
  haversineMeters,
} from "@/lib/geo";
import {
  enqueue,
  listPending,
  remove,
  bumpAttempts,
  MAX_ATTEMPTS,
  isOfflineErrorMessage,
  type PendingClock,
} from "@/lib/offline-clock-queue";
import { clockAction } from "./actions";

export type CaseOption = {
  id: string;
  code: string | null;
  name: string;
  location: string | null;
  lat: number | null;
  lng: number | null;
  geofence_radius_m: number;
  status: "active" | "paused";
};

export type AttendanceItem = {
  id: string;
  case_id: string | null;
  case_label: string | null;
  event_type: "clock_in" | "clock_out";
  lat: number;
  lng: number;
  accuracy_m: number | null;
  distance_m: number | null;
  within_geofence: boolean | null;
  note: string | null;
  created_at: string;
};

const TIME_FMT = new Intl.DateTimeFormat("zh-TW", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Taipei",
});

const NO_CASE = "__none__";

export function AttendanceClient({
  cases,
  initialToday,
}: {
  cases: CaseOption[];
  initialToday: AttendanceItem[];
}) {
  const router = useRouter();
  const geo = useGeolocation({ autoFetch: true });
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [autoPickedId, setAutoPickedId] = useState<string>("");
  const [note, setNote] = useState("");
  const [submitting, startTransition] = useTransition();
  const [submitMsg, setSubmitMsg] = useState<
    | { kind: "ok"; text: string }
    | { kind: "error"; text: string }
    | { kind: "queued"; text: string }
    | null
  >(null);

  // 離線佇列(Phase 2.24)— mount + online 事件時 flush
  const [pending, setPending] = useState<PendingClock[]>([]);
  const [flushing, setFlushing] = useState(false);

  const refreshPending = useCallback(async () => {
    try {
      const list = await listPending();
      setPending(list);
    } catch {
      // IndexedDB 不可用(隱私瀏覽 / 舊瀏覽器)→ 靜默,離線排隊不可用
    }
  }, []);

  const flushQueue = useCallback(async () => {
    if (flushing) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    setFlushing(true);
    try {
      const list = await listPending();
      for (const item of list) {
        if (item.attempts >= MAX_ATTEMPTS) continue;
        const fd = new FormData();
        fd.set("event_type", item.event_type);
        fd.set("case_id", item.case_id ?? "");
        fd.set("lat", String(item.lat));
        fd.set("lng", String(item.lng));
        fd.set("accuracy_m", item.accuracy_m === null ? "" : String(item.accuracy_m));
        fd.set("note", item.note ?? "");
        try {
          const res = await clockAction(fd);
          if (res.ok) {
            await remove(item.id);
          } else {
            // server 端 validation 拒絕 → 不會再成功,記下並停止重試
            await bumpAttempts(item.id, res.error);
          }
        } catch (e) {
          await bumpAttempts(item.id, (e as Error).message ?? "未知錯誤");
        }
      }
      await refreshPending();
      router.refresh();
    } finally {
      setFlushing(false);
    }
  }, [flushing, refreshPending, router]);

  // Mount + online event 時 flush
  useEffect(() => {
    void refreshPending();
    void flushQueue();
    const handler = () => {
      void flushQueue();
    };
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
    // 故意空 deps:只在 mount 跑一次,後續 online 事件靠 listener
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 依與目前位置的距離排序案件
  const casesByDistance = useMemo(() => {
    if (geo.status !== "ok") return cases;
    const me = { lat: geo.fix.lat, lng: geo.fix.lng };
    return [...cases].sort((a, b) => {
      const da = a.lat !== null && a.lng !== null
        ? haversineMeters(me, { lat: a.lat, lng: a.lng })
        : Infinity;
      const db = b.lat !== null && b.lng !== null
        ? haversineMeters(me, { lat: b.lat, lng: b.lng })
        : Infinity;
      return da - db;
    });
  }, [cases, geo]);

  // 自動推薦:有座標案件中,在 geofence 內的最近一個
  const recommended = useMemo(() => {
    if (geo.status !== "ok") return null;
    const me = { lat: geo.fix.lat, lng: geo.fix.lng };
    for (const c of casesByDistance) {
      if (c.lat === null || c.lng === null) continue;
      const d = haversineMeters(me, { lat: c.lat, lng: c.lng });
      if (d <= c.geofence_radius_m) return { c, d };
    }
    return null;
  }, [casesByDistance, geo]);

  // 第一次抓到 recommended → 自動選起來。使用者一旦手動改 select,
  // selectedCaseId 就有值,recommended 就不會再覆蓋。
  useEffect(() => {
    if (recommended && !autoPickedId && !selectedCaseId) {
      setAutoPickedId(recommended.c.id);
    }
  }, [recommended, autoPickedId, selectedCaseId]);

  const effectiveCaseId = selectedCaseId || autoPickedId || "";

  // 算當前選中案件的距離 + 是否在 geofence(供 UI 顯示)
  const evalForSelected = useMemo(() => {
    if (geo.status !== "ok" || !effectiveCaseId || effectiveCaseId === NO_CASE) return null;
    const c = cases.find((x) => x.id === effectiveCaseId);
    if (!c) return null;
    return evaluateGeofence(
      { lat: c.lat, lng: c.lng, geofence_radius_m: c.geofence_radius_m },
      { lat: geo.fix.lat, lng: geo.fix.lng },
    );
  }, [cases, effectiveCaseId, geo]);

  const noCase = effectiveCaseId === NO_CASE;
  const noteRequired = noCase;

  async function queueOffline(eventType: "clock_in" | "clock_out", reason: string) {
    if (geo.status !== "ok") return;
    try {
      await enqueue({
        event_type: eventType,
        case_id: noCase ? null : effectiveCaseId,
        lat: geo.fix.lat,
        lng: geo.fix.lng,
        accuracy_m: geo.fix.accuracy_m,
        note: note || null,
      });
      await refreshPending();
      const label = eventType === "clock_in" ? "上班" : "下班";
      setSubmitMsg({
        kind: "queued",
        text: `${label}打卡已離線存檔（${reason}）— 連上網路會自動送出`,
      });
      setNote("");
    } catch {
      setSubmitMsg({
        kind: "error",
        text: "離線排隊也失敗了(此瀏覽器不支援 IndexedDB)— 請改連 wifi / 換瀏覽器再試",
      });
    }
  }

  async function submit(eventType: "clock_in" | "clock_out") {
    if (geo.status !== "ok") return;
    if (noteRequired && !note.trim()) {
      setSubmitMsg({ kind: "error", text: "未選案件時請填說明(例:在辦公室)" });
      return;
    }

    // 顯式離線:不打 server 直接排隊,省一輪 fail 等待
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await queueOffline(eventType, "目前離線");
      return;
    }

    const fd = new FormData();
    fd.set("event_type", eventType);
    fd.set("case_id", noCase ? "" : effectiveCaseId);
    fd.set("lat", String(geo.fix.lat));
    fd.set("lng", String(geo.fix.lng));
    fd.set("accuracy_m", String(geo.fix.accuracy_m));
    fd.set("note", note);

    startTransition(async () => {
      setSubmitMsg(null);
      try {
        const res = await clockAction(fd);
        if (!res.ok) {
          // server 端業務錯誤 — 不該重試,直接報
          setSubmitMsg({ kind: "error", text: res.error });
          return;
        }
        const label = eventType === "clock_in" ? "上班打卡成功" : "下班打卡成功";
        const detail =
          res.within_geofence === false && res.distance_m !== null
            ? `（已標註:離工地 ${formatDistance(res.distance_m)},超出範圍）`
            : res.within_geofence === true && res.distance_m !== null
              ? `（離工地 ${formatDistance(res.distance_m)}）`
              : "";
        setSubmitMsg({ kind: "ok", text: label + detail });
        setNote("");
        router.refresh();
      } catch (e) {
        // 網路 error / fetch fail / server action 連不上 → 排隊
        const msg = (e as Error).message ?? "未知錯誤";
        if (isOfflineErrorMessage(msg)) {
          await queueOffline(eventType, "送出失敗");
        } else {
          setSubmitMsg({ kind: "error", text: "送出失敗:" + msg });
        }
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* 1) 定位狀態卡 */}
      <LocationStatusCard geo={geo} />

      {/* 2) 案件選擇 */}
      <section className="rounded-md border border-[#E0DCD6] bg-card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-primary">選擇案件</h2>
          {recommended && (
            <span className="text-xs text-[#4A7C59]">
              ✓ 自動推薦：{recommended.c.name}（在範圍內）
            </span>
          )}
        </div>
        <select
          value={effectiveCaseId}
          onChange={(e) => {
            setSelectedCaseId(e.target.value);
            setAutoPickedId(""); // 使用者一旦手動選,就不再被 recommended 覆蓋
          }}
          className="h-11 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-base text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          disabled={geo.status === "locating"}
        >
          <option value="">— 請選擇 —</option>
          <option value={NO_CASE}>📍 在公司 / 移動中（不指定案件）</option>
          {casesByDistance.map((c) => {
            const distLabel =
              geo.status === "ok" && c.lat !== null && c.lng !== null
                ? `  · ${formatDistance(haversineMeters({ lat: geo.fix.lat, lng: geo.fix.lng }, { lat: c.lat, lng: c.lng }))}`
                : c.lat === null
                  ? "  · 案件無座標"
                  : "";
            const status = c.status === "paused" ? " 〔暫停〕" : "";
            return (
              <option key={c.id} value={c.id}>
                {(c.code ? `${c.code}｜` : "") + c.name + status + distLabel}
              </option>
            );
          })}
        </select>

        {/* 顯示選中案件的 geofence 評估 */}
        {evalForSelected && evalForSelected.distanceM !== null && (
          <div
            className={`mt-2 rounded-md px-3 py-2 text-sm ${
              evalForSelected.withinGeofence
                ? "border border-[#A7D7B1] bg-[#ECFDF5] text-[#15803D]"
                : "border border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]"
            }`}
          >
            {evalForSelected.withinGeofence
              ? `✓ 在工地範圍內（${formatDistance(evalForSelected.distanceM)}）`
              : `⚠ 不在工地範圍內（${formatDistance(evalForSelected.distanceM)}）— 仍可打卡,辦公室會看到標註`}
          </div>
        )}
        {effectiveCaseId && !evalForSelected && !noCase && (
          <div className="mt-2 rounded-md border border-[#E0DCD6] bg-[#FBF8F4] px-3 py-2 text-sm text-muted-foreground">
            此案件尚未設定座標,系統無法計算距離。請辦公室到「案件編輯」補座標。
          </div>
        )}
      </section>

      {/* 3) 備註(no-case 必填) */}
      <section className="rounded-md border border-[#E0DCD6] bg-card p-4">
        <label className="mb-2 block text-sm font-medium text-primary">
          備註 {noteRequired && <span className="text-[#B91C1C]">*</span>}
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder={noteRequired ? "請說明(例:辦公室、移動到第二工地)" : "選填"}
          className="w-full rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-sm text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
      </section>

      {/* 4) 上下班按鈕 */}
      <div className="grid grid-cols-2 gap-3">
        <Button
          onClick={() => submit("clock_in")}
          disabled={geo.status !== "ok" || submitting || !effectiveCaseId}
          className="h-14 bg-primary text-base text-primary-foreground hover:bg-primary/90"
        >
          {submitting ? "送出中…" : "上班打卡"}
        </Button>
        <Button
          onClick={() => submit("clock_out")}
          disabled={geo.status !== "ok" || submitting || !effectiveCaseId}
          variant="outline"
          className="h-14 border-primary text-base text-primary hover:bg-primary/5"
        >
          {submitting ? "送出中…" : "下班打卡"}
        </Button>
      </div>

      {submitMsg && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            submitMsg.kind === "ok"
              ? "border border-[#A7D7B1] bg-[#ECFDF5] text-[#15803D]"
              : submitMsg.kind === "queued"
                ? "border border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]"
                : "border border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]"
          }`}
        >
          {submitMsg.text}
        </div>
      )}

      {/* 離線排隊 — 有待送出時顯示 */}
      <PendingQueueCard pending={pending} flushing={flushing} onRetry={flushQueue} />

      {/* 5) 今日打卡時間軸 */}
      <TodayTimeline items={initialToday} />
    </div>
  );
}

function PendingQueueCard({
  pending,
  flushing,
  onRetry,
}: {
  pending: PendingClock[];
  flushing: boolean;
  onRetry: () => void;
}) {
  if (pending.length === 0) return null;
  const failed = pending.filter((p) => p.attempts >= MAX_ATTEMPTS);
  return (
    <section className="rounded-md border border-[#FDE68A] bg-[#FFFBEB] p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-[#92400E]">
          離線待送出（{pending.length}）
          {failed.length > 0 && (
            <span className="ml-2 text-[#B91C1C]">
              · {failed.length} 筆已超過重試上限
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={onRetry}
          disabled={flushing}
          className="text-xs text-[#92400E] underline-offset-2 hover:underline disabled:opacity-50"
        >
          {flushing ? "送出中…" : "立即重試"}
        </button>
      </div>
      <ul className="space-y-1 text-xs text-[#5A5050]">
        {pending.slice(0, 5).map((p) => (
          <li key={p.id} className="flex items-center gap-2">
            <span className="font-mono tabular-nums">
              {TIME_FMT.format(new Date(p.client_created_at))}
            </span>
            <span>{p.event_type === "clock_in" ? "上班" : "下班"}</span>
            {p.attempts > 0 && (
              <span className="text-[#A07850]">· 已重試 {p.attempts} 次</span>
            )}
          </li>
        ))}
        {pending.length > 5 && (
          <li className="text-muted-foreground">…還有 {pending.length - 5} 筆</li>
        )}
      </ul>
    </section>
  );
}

function LocationStatusCard({ geo }: { geo: ReturnType<typeof useGeolocation> }) {
  if (geo.status === "idle" || geo.status === "locating") {
    return (
      <div className="rounded-md border border-[#E0DCD6] bg-[#FBF8F4] p-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Spinner /> 取得位置中…
        </div>
      </div>
    );
  }
  if (geo.status === "error") {
    return (
      <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-4 text-sm text-[#B91C1C]">
        <div className="font-medium">無法取得位置</div>
        <p className="mt-1">{geo.message}</p>
        <button
          type="button"
          onClick={geo.refresh}
          className="mt-2 text-xs text-[#B91C1C] underline-offset-2 hover:underline"
        >
          重新定位
        </button>
      </div>
    );
  }
  const level = accuracyLevel(geo.fix.accuracy_m);
  const levelLabel =
    level === "good" ? "GPS 精度良好" : level === "fair" ? "GPS 精度普通" : "GPS 精度較差";
  const levelClass =
    level === "good"
      ? "border-[#A7D7B1] bg-[#ECFDF5] text-[#15803D]"
      : level === "fair"
        ? "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]"
        : "border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]";
  return (
    <div className={`rounded-md border p-4 text-sm ${levelClass}`}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{levelLabel}</span>
        <button
          type="button"
          onClick={geo.refresh}
          className="text-xs underline-offset-2 hover:underline"
        >
          重新定位
        </button>
      </div>
      <div className="mt-1 font-mono text-xs tabular-nums">
        {geo.fix.lat.toFixed(6)}, {geo.fix.lng.toFixed(6)} · 精度 ±{Math.round(geo.fix.accuracy_m)} m
      </div>
      <a
        href={googleMapsLink({ lat: geo.fix.lat, lng: geo.fix.lng })}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-block text-xs underline-offset-2 hover:underline"
      >
        在 Google Maps 開啟 ↗
      </a>
    </div>
  );
}

function TodayTimeline({ items }: { items: AttendanceItem[] }) {
  if (items.length === 0) {
    return (
      <section className="rounded-md border border-dashed border-[#E0DCD6] bg-[#FBF8F4] p-4 text-center text-sm text-muted-foreground">
        今天還沒打卡
      </section>
    );
  }
  return (
    <section className="rounded-md border border-[#E0DCD6] bg-card p-4">
      <h2 className="mb-3 text-sm font-medium text-primary">今日打卡紀錄</h2>
      <ul className="space-y-2">
        {items.map((e) => (
          <li
            key={e.id}
            className="flex items-start gap-3 border-b border-[#F2EFEB] pb-2 last:border-b-0 last:pb-0"
          >
            <span className="mt-0.5 inline-block w-12 shrink-0 rounded-md bg-[#F5F1EC] py-1 text-center font-mono text-xs tabular-nums text-foreground">
              {TIME_FMT.format(new Date(e.created_at))}
            </span>
            <span
              className={`inline-block rounded-md px-2 py-0.5 text-xs ${
                e.event_type === "clock_in"
                  ? "bg-primary text-primary-foreground"
                  : "border border-primary text-primary"
              }`}
            >
              {e.event_type === "clock_in" ? "上班" : "下班"}
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <div className="truncate text-foreground">
                {e.case_label ?? "（在公司 / 移動中）"}
              </div>
              <div className="text-xs text-muted-foreground">
                {e.distance_m !== null ? formatDistance(e.distance_m) : "—"}
                {e.within_geofence === false && (
                  <span className="ml-1 text-[#A07850]">· 不在工地範圍</span>
                )}
                {e.note && <span className="ml-1">· {e.note}</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="animate-spin"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

