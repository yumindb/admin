import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import type { Case } from "@/lib/types";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  active: { label: "進行中", cls: "bg-[#ECFDF5] text-[#4A7C59] border-[#A7F3D0]" },
  paused: { label: "暫停", cls: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]" },
  closed: { label: "結案", cls: "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]" },
};

export default async function CasesPage() {
  const supabase = await createClient();

  // 角色導向首頁:supervisor → /logs,owner → /approvals,office_staff 留下看 cases
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role === "site_supervisor") redirect("/logs");
    if (profile?.role === "owner") redirect("/approvals");
  }

  const { data: cases, error } = await supabase
    .from("cases")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary md:text-3xl">案件</h1>
          <p className="mt-1.5 text-base text-muted-foreground">
            裕民工務目前管理的案件清單
          </p>
        </div>
        <Button
          asChild
          size="lg"
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Link href="/cases/new">+ 開新案</Link>
        </Button>
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          載入失敗：{error.message}
        </p>
      )}

      {!cases?.length ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {(cases as Case[]).map((c) => {
            const s = STATUS_LABEL[c.status] ?? STATUS_LABEL.active;
            return (
              <Link
                key={c.id}
                href={`/cases/${c.id}`}
                className="group rounded-lg border border-[#E0DCD6] bg-card p-6 transition-colors hover:border-accent"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {c.code ?? "未編號"}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${s.cls}`}
                  >
                    {s.label}
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-primary group-hover:text-accent md:text-xl">
                  {c.name}
                </h3>
                <p className="mt-2.5 line-clamp-1 text-base text-muted-foreground">
                  {c.location || "—"}
                </p>
                <div className="mt-5 flex items-center justify-between text-sm text-muted-foreground">
                  <span>{c.client || c.company}</span>
                  <span>
                    {c.started_at
                      ? new Date(c.started_at).toLocaleDateString("zh-TW")
                      : "—"}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-20 text-center">
      <div className="mb-3 text-5xl text-[#E0DCD6]">＋</div>
      <p className="mb-1.5 text-base text-foreground">還沒有任何案件</p>
      <p className="mb-6 text-sm text-muted-foreground">
        點下方按鈕開新案，接著上傳標單 .xlsx 自動建立工項
      </p>
      <Button
        asChild
        size="lg"
        className="bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <Link href="/cases/new">開第一個案件</Link>
      </Button>
    </div>
  );
}
