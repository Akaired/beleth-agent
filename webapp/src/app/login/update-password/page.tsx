import Link from "next/link";
import type { Metadata } from "next";
import { UpdatePasswordForm } from "@/app/login/update-password/update-password-form";

export const metadata: Metadata = {
  title: "Set a new password — Beleth",
};

export default function UpdatePasswordPage() {
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
        <UpdatePasswordForm />
      </div>
    </main>
  );
}
