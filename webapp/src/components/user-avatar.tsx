/**
 * A user's avatar: their uploaded image when they have one, otherwise a disc
 * with their initials. Gold hairline ring, matching the forum author avatar.
 * Plain markup — renders in Server and Client Components alike.
 */
function initialsOf(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name.trim().slice(0, 2) || "?").toUpperCase();
}

export function UserAvatar({
  name,
  avatarUrl,
  size = 32,
  className = "",
}: {
  /** Display name or email local-part — used for the initials fallback. */
  name: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const common =
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-acc/25";
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        aria-hidden
        width={size}
        height={size}
        className={`${common} object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${common} bg-chipbg font-mono font-medium text-sec ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
    >
      {initialsOf(name)}
    </span>
  );
}
