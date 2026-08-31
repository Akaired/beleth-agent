"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { roleAtLeast, type Role } from "@/lib/roles";
import {
  IconEnvelope,
  IconAccount,
  IconDocs,
  IconForum,
} from "@/components/icons";

type IconProps = { size?: number; weight?: "regular" | "bold" | "fill"; className?: string };
type Tab = {
  href: string;
  label: string;
  Icon: ComponentType<IconProps>;
  // Lowest role that may see the tab. Every tab is visible (read-only) to the
  // demo-admin account the judges use; the write controls inside each tab
  // render disabled below master_admin, and every server action / RPC
  // re-checks the role.
  min: Role;
  // Shown in the bar but not wired to a route yet — Davide fills these in later.
  disabled?: boolean;
};

// Horizontal tabs inside the content body, one row under the page title.
// Mirrors Sybil's admin shell (src/pages/admin/AdminLayout.tsx) but in the
// Beleth mono palette. Add a route + drop `disabled` to bring a tab online.
const TABS: Tab[] = [
  { href: "/dashboard/admin/email", label: "Email", Icon: IconEnvelope, min: "demo_admin" },
  { href: "/dashboard/admin/docs", label: "Documentation", Icon: IconDocs, min: "demo_admin" },
  { href: "/dashboard/admin/forum", label: "Forum", Icon: IconForum, min: "demo_admin" },
  { href: "/dashboard/admin/users", label: "Users", Icon: IconAccount, min: "demo_admin" },
];

export function AdminTabs({ role }: { role: Role }) {
  const pathname = usePathname();
  const tabs = TABS.filter((t) => roleAtLeast(role, t.min));

  return (
    <nav className="flex gap-1 overflow-x-auto rounded-md border border-line bg-panel p-1">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        const cls =
          "flex items-center gap-1.5 whitespace-nowrap rounded px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors";

        if (tab.disabled) {
          return (
            <span
              key={tab.href}
              aria-disabled="true"
              title="Coming soon"
              className={`${cls} text-faint cursor-default select-none`}
            >
              <tab.Icon size={13} className="shrink-0" />
              {tab.label}
              <span className="ml-1 text-[8.5px] tracking-[0.12em] text-faint/70">soon</span>
            </span>
          );
        }

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`${cls} ${
              active ? "bg-acc/15 text-acc" : "text-sec hover:text-txt"
            }`}
          >
            <tab.Icon size={13} weight={active ? "bold" : "regular"} className="shrink-0" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
