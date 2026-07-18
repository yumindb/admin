import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCompanyShort } from "@/lib/companies";
import { emailToUsername } from "@/lib/auth/username";
import { PasswordForm } from "./password-form";
import { LineBindingCard } from "./line-binding-card";
import {
  NOTIFICATION_CATEGORIES,
  resolvePrefs,
  type NotificationPrefs,
} from "@/lib/notifications/prefs";
import type { UserRole } from "@/lib/types";

const ROLE_LABEL: Record<string, string> = {
  office_staff: "辦公室助理",
  site_supervisor: "工地主任",
  owner: "老闆",
  field_assistant: "現場人員",
};

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, company, phone")
    .eq("id", user.id)
    .maybeSingle();

  // LINE 綁定狀態(migration-2.27;還沒跑 migration 時 data 會是 null,卡片顯示未綁定)
  const { data: lineBinding } = await supabase
    .from("line_bindings")
    .select("line_user_id, bound_at, notifications_enabled, notification_prefs")
    .eq("profile_id", user.id)
    .maybeSingle();
  const lineBound = Boolean(lineBinding?.line_user_id);

  // 這個人會收到哪些通知(分類開關 migration-2.28;由 /staff 管理端設定)
  const effectivePrefs = profile?.role
    ? resolvePrefs(
        (lineBinding?.notification_prefs as NotificationPrefs | null) ?? null,
        profile.role as UserRole,
      )
    : null;
  const receiveLabels = effectivePrefs
    ? NOTIFICATION_CATEGORIES.filter((c) => effectivePrefs[c.key]).map(
        (c) => c.label,
      )
    : [];
  const boundAtText = lineBinding?.bound_at
    ? new Intl.DateTimeFormat("zh-TW", {
        timeZone: "Asia/Taipei",
        dateStyle: "medium",
      }).format(new Date(lineBinding.bound_at as string))
    : null;

  const roleLabel = profile?.role
    ? ROLE_LABEL[profile.role] ?? profile.role
    : "—";
  const company = profile?.company
    ? getCompanyShort(profile.company)
    : "—";

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-2 text-2xl font-semibold text-primary md:text-3xl">
        我的帳號
      </h1>
      <p className="mb-7 text-base text-muted-foreground">
        修改密碼或檢視個人資料。如果忘記目前密碼，請聯絡辦公室助理或老闆協助重設。
      </p>

      <section className="mb-8 rounded-lg border border-[#E0DCD6] bg-card p-5">
        <h2 className="mb-3 text-base font-semibold text-primary md:text-lg">
          基本資料
        </h2>
        <dl className="space-y-2 text-sm">
          <Row label="姓名" value={profile?.full_name ?? "—"} />
          <Row label="帳號" value={emailToUsername(user.email) ?? "—"} />
          <Row label="角色" value={roleLabel} />
          <Row label="所屬公司" value={company} />
          <Row label="電話" value={profile?.phone ?? "—"} />
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          以上欄位若需更動，請聯絡管理員。
        </p>
      </section>

      <section className="mb-8 rounded-lg border border-[#E0DCD6] bg-card p-5">
        <h2 className="mb-1 text-base font-semibold text-primary md:text-lg">
          LINE 通知
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          綁定 LINE 後，待簽核、退回、請假結果等通知會即時傳到你的 LINE。
        </p>
        <LineBindingCard
          bound={lineBound}
          boundAtText={boundAtText}
          notificationsEnabled={lineBinding?.notifications_enabled ?? true}
          receiveLabels={receiveLabels}
        />
      </section>

      <section className="rounded-lg border border-[#E0DCD6] bg-card p-5">
        <h2 className="mb-1 text-base font-semibold text-primary md:text-lg">
          修改密碼
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          需要先輸入目前密碼，再輸入新密碼兩次。
        </p>
        <PasswordForm />
      </section>

      <section className="mt-8 rounded-lg border border-[#E0DCD6] bg-card p-5">
        <h2 className="mb-1 text-base font-semibold text-primary md:text-lg">
          使用說明書
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          每個功能的操作步驟、常見問題、疑難排解都在裡面，還可以按「朗讀」用聽的。
        </p>
        <a
          href="/manual.html"
          target="_blank"
          rel="noopener"
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          打開使用說明書
        </a>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all text-foreground">{value}</dd>
    </div>
  );
}
