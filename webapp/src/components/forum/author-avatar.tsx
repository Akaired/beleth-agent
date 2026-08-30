/**
 * Initials disc for a forum author. There are no per-user avatars yet — the
 * denormalised `author_name` (email local-part, trigger-stamped) is all we have.
 * Gold hairline ring, matching the account-dropdown avatar.
 */
export function AuthorAvatar({
  name,
  size = 32,
}: {
  name: string;
  size?: number;
}) {
  const initials = (name || "?").slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-chipbg font-mono font-medium text-sec ring-1 ring-acc/25"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
    >
      {initials}
    </span>
  );
}
