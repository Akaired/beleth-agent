"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { roleAtLeast, type Role } from "@/lib/roles";
import {
  IconOverview,
  IconDecisions,
  IconStrategy,
  IconControls,
} from "@/components/icons";

type IconProps = { size?: number; weight?: "regular" | "bold" | "fill"; className?: string };
type Item = { href: string; label: string; min: Role; Icon: ComponentType<IconProps> };

const ITEMS: Item[] = [
  { href: "/dashboard", label: "Overview", min: "public_user", Icon: IconOverview },
  { href: "/dashboard/decisions", label: "Decisions", min: "demo_admin", Icon: IconDecisions },
  { href: "/dashboard/strategy", label: "Strategy", min: "demo_admin", Icon: IconStrategy },
  { href: "/dashboard/controls", label: "Controls", min: "master_admin", Icon: IconControls },
];

export function DashboardNav({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {ITEMS.filter((it) => roleAtLeast(role, it.min)).map((it) => {
        const active =
          it.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[12.5px] transition-colors ${
              active ? "bg-chipbg text-txt" : "text-sec hover:text-txt"
            }`}
          >
            <it.Icon size={14} weight={active ? "bold" : "regular"} />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
