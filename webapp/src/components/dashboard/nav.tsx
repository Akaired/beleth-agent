"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { roleAtLeast, type Role } from "@/lib/roles";

type Item = { href: string; label: string; min: Role };

const ITEMS: Item[] = [
  { href: "/dashboard", label: "Overview", min: "public_user" },
  { href: "/dashboard/decisions", label: "Decisions", min: "demo_admin" },
  { href: "/dashboard/strategy", label: "Strategy", min: "demo_admin" },
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
            className={`px-2.5 py-1 rounded text-[12.5px] transition-colors ${
              active
                ? "bg-chipbg text-txt"
                : "text-sec hover:text-txt"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
