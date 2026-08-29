"use client";

import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { roleAtLeast, type Role } from "@/lib/roles";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { RoleChip } from "@/components/dashboard/ui";
import {
  IconOverview,
  IconPositions,
  IconDecisions,
  IconStrategy,
  IconControls,
  IconMenu,
  IconClose,
} from "@/components/icons";

type IconProps = { size?: number; weight?: "regular" | "bold" | "fill"; className?: string };
type Item = { href: string; label: string; min: Role; Icon: ComponentType<IconProps> };
type Group = { label: string; items: Item[] };

// Sidebar groups, 1:1 with the approved mockup
// (the design mockup — navDefs). Items whose route
// does not exist yet (Reasoning, Account detail) are omitted until built.
const GROUPS: Group[] = [
  {
    label: "Live",
    items: [
      { href: "/dashboard", label: "Overview", min: "public_user", Icon: IconOverview },
      { href: "/dashboard/positions", label: "Positions", min: "demo_admin", Icon: IconPositions },
    ],
  },
  {
    label: "Records",
    items: [
      { href: "/dashboard/decisions", label: "Decision history", min: "demo_admin", Icon: IconDecisions },
      { href: "/dashboard/strategy", label: "Strategy strategy", min: "demo_admin", Icon: IconStrategy },
    ],
  },
  {
    label: "Operator",
    items: [
      { href: "/dashboard/controls", label: "Controls", min: "master_admin", Icon: IconControls },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/dashboard"
    ? pathname === "/dashboard"
    : pathname.startsWith(href);
}

function NavGroups({
  role,
  badges,
  onNavigate,
}: {
  role: Role;
  badges?: Record<string, number>;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => roleAtLeast(role, it.min)),
  })).filter((g) => g.items.length > 0);

  return (
    <nav className="flex flex-col py-1">
      {groups.map((g) => (
        <div key={g.label} className="pt-3 pb-1">
          <div className="px-3 pb-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint">
            {g.label}
          </div>
          {g.items.map((it) => {
            const active = isActive(pathname, it.href);
            const badge = badges?.[it.href] ?? 0;
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 border-l-2 py-[7px] pl-2.5 pr-3 text-[12.5px] transition-colors ${
                  active
                    ? "border-acc bg-hoverbg text-txt"
                    : "border-transparent text-sec hover:text-txt"
                }`}
              >
                <it.Icon
                  size={15}
                  weight={active ? "bold" : "regular"}
                  className={active ? "text-acc" : "text-dim"}
                />
                <span>{it.label}</span>
                {badge > 0 && (
                  <span
                    className="ml-auto min-w-[18px] rounded-full bg-acc/15 px-1.5 py-px text-center font-mono text-[10px] font-medium text-acc"
                    title={`${badge} open position${badge === 1 ? "" : "s"}`}
                  >
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter() {
  return (
    <div className="mt-auto border-t border-line px-3 py-3">
      <SignOutButton />
    </div>
  );
}

function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <Link
      href="/dashboard"
      onClick={onClick}
      className="flex items-center gap-2.5 font-mono text-[13px] font-medium tracking-[0.14em]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/beleth.png"
        alt="Beleth"
        width={18}
        height={21}
        className="w-[18px] [image-rendering:pixelated]"
      />
      BELETH
    </Link>
  );
}

export function DashboardChrome({
  role,
  email,
  badges,
  children,
}: {
  role: Role;
  email: string | null;
  badges?: Record<string, number>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // The drawer closes itself on navigation via each link's onNavigate; this
  // effect only handles Escape-to-close and body scroll lock while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="flex flex-col md:h-dvh md:overflow-hidden">
      {/* Top bar — full width */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line px-4 md:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="flex h-9 w-9 items-center justify-center rounded text-sec transition-colors hover:text-txt md:hidden"
          >
            <IconMenu size={20} />
          </button>
          <Brand />
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-[11px] text-dim">{email}</span>
          <RoleChip role={role} />
        </div>
      </header>

      <div className="flex-1 min-h-0 md:grid md:grid-cols-[196px_minmax(0,1fr)] md:overflow-hidden">
        {/* Desktop rail */}
        <aside className="hidden md:flex md:flex-col md:border-r md:border-line md:overflow-y-auto">
          <NavGroups role={role} badges={badges} />
          <SidebarFooter />
        </aside>

        <main className="md:overflow-y-auto">
          <div className="px-4 md:px-6 py-6 max-w-6xl w-full mx-auto">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile drawer + backdrop */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-[240px] max-w-[80%] flex-col border-r border-line bg-bg shadow-xl"
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-3">
              <Brand onClick={() => setOpen(false)} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="flex h-9 w-9 items-center justify-center rounded text-sec transition-colors hover:text-txt"
              >
                <IconClose size={18} />
              </button>
            </div>
            <div className="flex flex-1 flex-col overflow-y-auto">
              <NavGroups
                role={role}
                badges={badges}
                onNavigate={() => setOpen(false)}
              />
              <SidebarFooter />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
