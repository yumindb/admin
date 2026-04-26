import Image from "next/image";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next = "/" } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Image
            src="/yumin-badge.svg"
            alt="裕民工務"
            width={56}
            height={80}
            priority
            className="mb-3 h-14 w-auto"
          />
          <h1 className="text-2xl font-semibold tracking-wide text-primary">
            裕民工務 管理系統
          </h1>
        </div>

        <div className="rounded-md border border-[#E0DCD6] bg-card p-6 shadow-none">
          <LoginForm next={next} />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          POC 試用 · 帳號由系統管理員建立
        </p>
      </div>
    </main>
  );
}
