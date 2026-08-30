"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/dashboard/admin/email", label: "Overview" },
  { href: "/dashboard/admin/email/templates", label: "Templates" },
  { href: "/dashboard/admin/email/campaigns", label: "Campaigns" },
  { href: "/dashboard/admin/email/audiences", label: "Audiences" },
] as const;

export function EmailSubnav() {
  const pathname = usePathname();

  return (
    <div className="flex gap-4 border-b border-line">
      {ITEMS.map((it) => {
        const active =
          it.href === "/dashboard/admin/email"
            ? pathname === it.href
            : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-0.5 pb-2 text-[12.5px] transition-colors ${
              active
                ? "border-acc text-txt"
                : "border-transparent text-sec hover:text-txt"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}
