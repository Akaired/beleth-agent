"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconEnvelope, IconAccount, IconData } from "@/components/icons";

type IconProps = { size?: number; weight?: "regular" | "bold" | "fill"; className?: string };
type Tab = {
  href: string;
  label: string;
  Icon: ComponentType<IconProps>;
  // Shown in the bar but not wired to a route yet — Davide fills these in later.
  disabled?: boolean;
};

// Horizontal tabs inside the content body, one row under the page title.
// Mirrors Sybil's admin shell (src/pages/admin/AdminLayout.tsx) but in the
// Beleth mono palette. Add a route + drop `disabled` to bring a tab online.
const TABS: Tab[] = [
  { href: "/dashboard/admin/email", label: "Email", Icon: IconEnvelope },
  { href: "/dashboard/admin/users", label: "Users", Icon: IconAccount, disabled: true },
  { href: "/dashboard/admin/environment", label: "Environment", Icon: IconData, disabled: true },
];

export function AdminTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto rounded-md border border-line bg-panel p-1">
      {TABS.map((tab) => {
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
