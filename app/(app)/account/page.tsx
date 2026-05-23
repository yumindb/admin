import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCompanyShort } from "@/lib/companies";
import { emailToUsername } from "@/lib/auth/username";
import { PasswordForm } from "./password-form";

const ROLE_LABEL: Record<string, string> = {
  office_staff: "辦公室助理",
  site_supervisor: "工地主任",
  owner: "老闆",
  field_assistant: "現場助理",
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
        修改密碼或檢視個人資料。如果忘記目前密碼,請聯絡辦公室助理或老闆協助重設。
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
          以上欄位若需更動,請聯絡管理員。
        </p>
      </section>

      <section className="rounded-lg border border-[#E0DCD6] bg-card p-5">
        <h2 className="mb-1 text-base font-semibold text-primary md:text-lg">
          修改密碼
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          需要先輸入目前密碼,再輸入新密碼兩次。
        </p>
        <PasswordForm />
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
