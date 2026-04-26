import Link from "next/link";
import { NewCaseForm } from "./new-case-form";

export default function NewCasePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <nav className="mb-3 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-accent">
          案件
        </Link>
        <span className="mx-1.5">／</span>
        <span>開新案</span>
      </nav>
      <h1 className="mb-6 text-xl font-semibold text-primary">開新案</h1>

      <div className="rounded-md border border-[#E0DCD6] bg-card p-6">
        <NewCaseForm />
      </div>
    </div>
  );
}
