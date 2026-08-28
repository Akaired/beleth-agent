import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { DashboardNav } from "@/components/dashboard/nav";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { RoleChip } from "@/components/dashboard/ui";

export default async function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  const ctx = await requireSession();

  return (
    <div className="flex flex-col min-h-screen">
      <header className="flex items-center justify-between gap-4 h-12 px-4 md:px-6 border-b border-line">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 font-mono text-[13px] font-medium tracking-[0.14em]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/beleth.png"
              alt="Beleth"
              width={20}
              height={23}
              className="w-5 [image-rendering:pixelated]"
            />
            BELETH
          </Link>
          <span className="hidden sm:block h-4 w-px bg-line" />
          <DashboardNav role={ctx.role} />
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden md:inline text-[11px] text-dim">
            {ctx.email}
          </span>
          <RoleChip role={ctx.role} />
          <SignOutButton />
        </div>
      </header>

      <main className="flex-1 px-4 md:px-6 py-6 max-w-6xl w-full mx-auto">
        {children}
      </main>

      <footer className="px-4 md:px-6 py-4 border-t border-line text-[11px] text-dim">
        Paper trading only. Every position carries a defined, known maximum
        loss; losing trades are normal and expected. This dashboard reads the
        same decision log the agent writes — it never sends orders.
      </footer>
    </div>
  );
}
