import Link from "next/link";
import { IconSignIn } from "@/components/icons";

/**
 * The "you are not logged in" box shown where the composer / New-topic button
 * would be for a signed-in visitor. `next` is the path to return to after login.
 */
export function LoginToPost({ next }: { next: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-emphline bg-inset px-4 py-3.5">
      <p className="text-[12.5px] text-sec">
        You are not logged in. Log in to start topics and reply.
      </p>
      <Link
        href={`/login?next=${encodeURIComponent(next)}`}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-txt px-3 py-1.5 text-[12px] font-medium text-bg transition-colors hover:bg-acc"
      >
        <IconSignIn size={13} weight="fill" />
        Log in
      </Link>
    </div>
  );
}
