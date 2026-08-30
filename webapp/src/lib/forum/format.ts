/** Relative time — client-safe copy of the dashboard `timeAgo` helper. */
export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if (secs < 90) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

/** True when a row's body was edited well after it was created. */
export function wasEdited(createdAt: string, updatedAt: string): boolean {
  return (
    new Date(updatedAt).getTime() - new Date(createdAt).getTime() > 1000
  );
}
