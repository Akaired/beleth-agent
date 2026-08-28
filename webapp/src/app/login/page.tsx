import Link from "next/link";
import type { Metadata } from "next";
import { LoginForm } from "@/app/login/login-form";

export const metadata: Metadata = {
  title: "Sign in — Beleth",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const raw = sp?.next;
  const nextParam = Array.isArray(raw) ? raw[0] : raw;
  const next =
    typeof nextParam === "string" && nextParam.startsWith("/dashboard")
      ? nextParam
      : "/dashboard";

  return (
    <main className="flex flex-1 min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="flex items-center gap-2.5 mb-10 font-mono text-[13px] font-medium tracking-[0.14em]"
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
        <LoginForm next={next} />
      </div>
    </main>
  );
}
