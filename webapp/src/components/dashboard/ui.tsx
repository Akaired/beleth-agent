import type { ReactNode } from "react";
import type { Role } from "@/lib/roles";
import { IconCheckCircle, IconProhibit, IconXCircle } from "@/components/icons";

export function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title?: string;
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

export function ActionBadge({ action }: { action: "trade" | "no_trade" }) {
  const isTrade = action === "trade";
  const Icon = isTrade ? IconCheckCircle : IconProhibit;
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] uppercase rounded px-1.5 py-0.5 ${
        isTrade ? "bg-up/15 text-up" : "bg-chipbg text-sec"
      }`}
    >
      <Icon size={11} weight="bold" />
      {isTrade ? "TRADE" : "NO TRADE"}
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
