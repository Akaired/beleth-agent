"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconAccount } from "@/components/icons";

type IconProps = { size?: number; weight?: "regular" | "bold" | "fill"; className?: string };
type Tab = {
  href: string;
  label: string;
  Icon: ComponentType<IconProps>;
  // Shown in the bar but not wired to a route yet.
  disabled?: boolean;
};

// Horizontal tabs inside the content body, one row under the page title.
// Mirrors the admin shell (src/components/dashboard/admin-tabs.tsx). Only
// "Account" is live for now; add a route + drop `disabled` to bring more on.
const TABS: Tab[] = [
  { href: "/dashboard/settings/account", label: "Account", Icon: IconAccount },
];

export function SettingsTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto rounded-md border border-line bg-panel p-1">
      {TABS.map((tab) => {
        const active =
          pathname === tab.href || pathname.startsWith(`${tab.href}/`);
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
              <span className="ml-1 text-[8.5px] tracking-[0.12em] text-faint/70">
                soon
              </span>
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
            <tab.Icon
              size={13}
              weight={active ? "bold" : "regular"}
              className="shrink-0"
            />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
