import Link from "next/link";
import { IconPlus } from "@/components/icons";

/** The "+ New topic" CTA, styled like the chat "New chat" button. */
export function NewTopicButton({ categorySlug }: { categorySlug?: string }) {
  const href = categorySlug
    ? `/forum/new?category=${encodeURIComponent(categorySlug)}`
    : "/forum/new";
  return (
    <Link
      href={href}
      className="flex shrink-0 items-center gap-1.5 rounded-md bg-acc/15 px-3 py-1.5 text-[12px] text-acc transition-colors hover:bg-acc/25"
    >
      <IconPlus size={13} weight="bold" />
      New topic
    </Link>
  );
}
