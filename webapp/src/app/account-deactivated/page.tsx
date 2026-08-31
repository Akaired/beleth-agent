import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { DeactivatedActions } from "@/app/account-deactivated/deactivated-actions";

export const metadata: Metadata = { title: "Account deactivated — Beleth" };

export default async function AccountDeactivatedPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.status !== "deactivated") redirect("/dashboard");

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-[420px]">
        <Link
          href="/"
          className="mb-8 flex items-center justify-center gap-2.5 font-mono text-[13px] font-medium tracking-[0.14em]"
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

        <div className="rounded-lg border border-line bg-panel p-6 text-center">
          <h1 className="text-[16px] font-medium text-txt">
            Your account is deactivated
          </h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-sec">
            You suspended it from settings. Nothing has been deleted — your
            profile, forum posts, and experience are all still here. Reactivate
            to pick up where you left off.
          </p>

          <DeactivatedActions />
        </div>
      </div>
    </main>
  );
}
