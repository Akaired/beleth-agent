import Link from "next/link";
import { AuthorAvatar } from "@/components/forum/author-avatar";

/**
 * A forum author, linked to their public profile (/u/<id>). Renders the
 * initials disc and, optionally, the name beside it. Falls back to plain,
 * unlinked markup when the author id is missing (older rows, or an embed that
 * didn't select it).
 */
export function AuthorLink({
  authorId,
  name,
  avatarUrl = null,
  size = 32,
  showName = false,
  className = "",
}: {
  authorId: string | null | undefined;
  name: string;
  avatarUrl?: string | null;
  size?: number;
  showName?: boolean;
  className?: string;
}) {
  const label = name || "someone";

  const inner = (
    <>
      <AuthorAvatar name={label} avatarUrl={avatarUrl} size={size} />
      {showName && <span>{label}</span>}
    </>
  );

  if (!authorId) {
    return showName ? (
      <span className={`inline-flex items-center gap-2 ${className}`}>
        {inner}
      </span>
    ) : (
      <AuthorAvatar name={label} avatarUrl={avatarUrl} size={size} />
    );
  }

  return (
    <Link
      href={`/u/${authorId}`}
      className={`inline-flex items-center gap-2 transition-colors hover:text-acc ${className}`}
    >
      {inner}
    </Link>
  );
}
