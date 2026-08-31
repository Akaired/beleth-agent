import type { ComponentType, ReactNode } from "react";
import type { Role } from "@/lib/roles";
import {
  IconArrowDown,
  IconArrowUp,
  IconCheckCircle,
  IconProhibit,
  IconPulse,
  IconWarning,
  IconXCircle,
} from "@/components/icons";

type IconProps = {
  size?: number;
  weight?: "regular" | "bold" | "fill";
  className?: string;
};

export function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`border border-line rounded-md bg-panel overflow-hidden ${className}`}
    >
      {title && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-panel-head border-b border-line">
          <h2 className="font-mono text-[10.5px] tracking-[0.1em] text-sec uppercase">
            {title}
          </h2>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const ROLE_LABEL: Record<Role, string> = {
  public_user: "public",
  demo_admin: "demo admin · read-only",
  master_admin: "master admin",
};

export function RoleChip({ role }: { role: Role }) {
  const tone =
    role === "master_admin"
      ? "text-acc border-acc/40"
      : role === "demo_admin"
        ? "text-txt border-emphline"
        : "text-sec border-line";
  return (
    <span
      className={`font-mono text-[10px] tracking-[0.08em] uppercase border rounded px-1.5 py-0.5 ${tone}`}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}

/**
 * The decision's `action` says what the layer *chose*; `outcome` (derived from the
 * `trades` rows the same cycle wrote, see `deriveOrderOutcome`) says what actually
 * happened to the order. A `trade` decision can still be stood down after the fact
 * by the marketability/slippage gate, so a bare "TRADE" badge overstates it.
 */
export function ActionBadge({
  action,
  outcome,
}: {
  action: "trade" | "no_trade";
  outcome?: "submitted" | "submit_failed" | "not_sent" | null;
}) {
  if (action !== "trade") {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] uppercase rounded px-1.5 py-0.5 bg-chipbg text-sec">
        <IconProhibit size={11} weight="bold" />
        NO TRADE
      </span>
    );
  }

  const variant =
    outcome === "not_sent"
      ? { cls: "bg-acc/15 text-acc", Icon: IconWarning, label: "TRADE · NOT SENT" }
      : outcome === "submit_failed"
        ? { cls: "bg-down/15 text-down", Icon: IconXCircle, label: "TRADE · FAILED" }
        : { cls: "bg-up/15 text-up", Icon: IconCheckCircle, label: "TRADE" };

  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] uppercase rounded px-1.5 py-0.5 ${variant.cls}`}
    >
      <variant.Icon size={11} weight="bold" />
      {variant.label}
    </span>
  );
}

const POSITION_STATE_STYLE: Record<
  string,
  { badge: string; Icon: ComponentType<IconProps> }
> = {
  open: { badge: "bg-acc/12 text-acc", Icon: IconPulse },
  closed: { badge: "bg-up/12 text-up", Icon: IconCheckCircle },
  canceled: { badge: "bg-chipbg text-sec", Icon: IconProhibit },
  failed: { badge: "bg-down/12 text-down", Icon: IconWarning },
};

export function PositionStateBadge({
  state,
}: {
  state: "open" | "closed" | "canceled" | "failed";
}) {
  const s = POSITION_STATE_STYLE[state] ?? POSITION_STATE_STYLE.canceled;
  return (
    <span
      className={`inline-flex w-[104px] items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] uppercase rounded px-2 py-0.5 ${s.badge}`}
    >
      <s.Icon size={11} weight="bold" className="shrink-0" />
      {state}
    </span>
  );
}

/**
 * BUY / SELL pill with a direction arrow. The agent SELLS the short leg to
 * open (that is where the credit comes from) and BUYS the long leg as defined
 * protection; on a close the mirror. A whole credit spread reads as SELL,
 * since it is opened for a net credit. Green + up arrow = buy, red + down
 * arrow = sell — the trading convention, so the direction reads at a glance.
 */
export function SideTag({
  side,
  size = "sm",
}: {
  side: "buy" | "sell";
  size?: "sm" | "md";
}) {
  const buy = side === "buy";
  const Icon = buy ? IconArrowUp : IconArrowDown;
  const md = size === "md";
  return (
    <span
      className={`inline-flex items-center justify-center gap-1 font-mono font-medium tracking-[0.1em] uppercase rounded-sm ${
        md ? "text-[10.5px] px-1.5 py-0.5" : "text-[9.5px] px-1 py-0.5"
      } ${buy ? "bg-up/12 text-up" : "bg-down/12 text-down"}`}
    >
      <Icon size={md ? 12 : 10} weight="bold" className="shrink-0" />
      {side}
    </span>
  );
}

export function PassFail({ ok, label }: { ok: boolean; label?: string }) {
  const Icon = ok ? IconCheckCircle : IconXCircle;
  return (
    <span
      className={`inline-flex items-center gap-1 ${ok ? "text-up" : "text-down"}`}
    >
      <Icon size={12} weight="fill" />
      {label ?? (ok ? "pass" : "fail")}
    </span>
  );
}

export function ForbiddenPanel() {
  return (
    <Panel title="Not available for your account">
      <p className="text-[13px] text-sec leading-relaxed">
        This is part of the read-only backoffice, visible to the demo-admin and
        master-admin accounts. Your account has the curated dashboard only.
      </p>
    </Panel>
  );
}

export function formatUsd(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/a";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/a";
  return `${(n * 100).toFixed(digits)}%`;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if (secs < 90) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}
