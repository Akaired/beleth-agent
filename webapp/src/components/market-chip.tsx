/**
 * MARKET OPEN / MARKET CLOSED indicator. `open === null` means we could not
 * read Alpaca's clock. Pure — safe in server and client components alike.
 */
export function MarketChip({
  open,
  bordered = false,
  className = "",
}: {
  open: boolean | null | undefined;
  bordered?: boolean;
  className?: string;
}) {
  const tone =
    open === true ? "text-up" : open === false ? "text-down" : "text-faint";
  const label =
    open === true
      ? "Market open"
      : open === false
        ? "Market closed"
        : "Market —";

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] ${tone} ${
        bordered ? "rounded border border-line px-1.5 py-0.5" : ""
      } ${className}`}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}
