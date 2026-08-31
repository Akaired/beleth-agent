/**
 * A forum author's avatar: their uploaded image when they have one, otherwise a
 * disc with their initials. Gold hairline ring, matching the account-dropdown
 * avatar. The avatar URL is resolved per page in `src/lib/forum/queries.ts`
 * (`beleth_public_avatars`); older embeds that don't select it fall back to
 * initials.
 */
export function AuthorAvatar({
  name,
  avatarUrl = null,
  size = 32,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  const common =
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-chipbg ring-1 ring-acc/25";

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        aria-hidden
        width={size}
        height={size}
        className={`${common} object-cover`}
        style={{ width: size, height: size }}
      />
    );
  }

  const initials = (name || "?").slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden
      className={`${common} font-mono font-medium text-sec`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
    >
      {initials}
    </span>
  );
}
