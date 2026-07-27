import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetActor } from "@/lib/auth/require-role";
import { RegenPdfsClient } from "./regen-client";

// 單筆重產(撈照片 + render PDF)可能超過 serverless 預設 10s —
// 拉到 Hobby 上限,照片多的日誌也跑得完
export const maxDuration = 60;

export default async function RegenPdfsPage() {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role !== "office_staff" && actor.role !== "owner") {
    redirect("/reports");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/reports" className="hover:text-accent">
          報表
        </Link>
        <span className="mx-1.5">／</span>
        <span>PDF 批次重產</span>
      </nav>
      <h1 className="mb-2 text-2xl font-semibold text-primary md:text-3xl">
        PDF 批次重產
      </h1>
      <p className="mb-7 text-base text-muted-foreground">
        把所有已核定日誌的 PDF 用目前的版面重新產生一次（例如簽名比例修正後，
        讓舊件也套用新版面）。內容與簽核紀錄不會變，只是重新排版。
      </p>
      <RegenPdfsClient />
    </div>
  );
}
