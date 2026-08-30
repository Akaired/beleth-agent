import Link from "next/link";
import type { Metadata } from "next";
import { LoginForm } from "@/app/login/login-form";

export const metadata: Metadata = {
  title: "Log in / Register — Beleth",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;

  const rawNext = Array.isArray(sp?.next) ? sp?.next[0] : sp?.next;
  const next =
    typeof rawNext === "string" && rawNext.startsWith("/dashboard")
      ? rawNext
      : "/dashboard";

  const rawMode = Array.isArray(sp?.mode) ? sp?.mode[0] : sp?.mode;
  const initialMode = rawMode === "signup" ? "signup" : "signin";

  const rawError = Array.isArray(sp?.error) ? sp?.error[0] : sp?.error;
  const initialError =
    rawError === "auth"
      ? "That sign-in link didn't work. Try again."
      : null;

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-[400px]">
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
        <LoginForm
          next={next}
          initialMode={initialMode}
          initialError={initialError}
        />
      </div>
    </main>
  );
}
