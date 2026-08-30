"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOutAction } from "@/app/dashboard/actions";
import type { Role } from "@/lib/roles";
import { UserAvatar } from "@/components/user-avatar";
import {
  IconAccount,
  IconBell,
  IconCaretDown,
  IconCrown,
  IconEye,
  IconHome,
  IconSignOut,
} from "@/components/icons";

/**
 * Role mark shown left of the name: a gold crown for the master admin, a gold
 * eye for the read-only observer (demo admin), nothing for a plain user.
 */
function RoleMark({ role }: { role: Role }) {
  if (role === "master_admin")
    return (
      <IconCrown size={13} weight="fill" className="text-acc" aria-label="master admin" />
    );
  if (role === "demo_admin")
    return (
      <IconEye size={13} weight="fill" className="text-acc" aria-label="observer" />
    );
  return null;
}

/**
 * Account menu for a signed-in viewer. Notification bell (placeholder) sits to
 * the left of the trigger. The first menu item ("home") points at `homeHref`:
 * the dashboard chrome sends it to the public homepage, the public header sends
 * it to the dashboard.
 */
export function AccountDropdown({
  role,
  email,
  displayName = null,
  avatarUrl = null,
  homeHref,
  homeLabel,
  showNotifications = true,
}: {
  role: Role;
  email: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  homeHref: string;
  homeLabel: string;
  /** The notification bell lives in the backoffice only, not the public header. */
  showNotifications?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = displayName || (email ?? "account").split("@")[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex items-center gap-1">
      {showNotifications && (
        <button
          type="button"
          aria-label="Notifications"
          title="Notifications"
          className="flex h-8 w-8 items-center justify-center rounded text-dim transition-colors hover:text-sec"
        >
          <IconBell size={18} />
        </button>
      )}

      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-2 rounded px-1 py-1 text-sec transition-colors hover:text-txt"
        >
          <UserAvatar name={name} avatarUrl={avatarUrl} size={28} />
          <RoleMark role={role} />
          <span className="hidden text-[12.5px] text-txt sm:inline">{name}</span>
          <IconCaretDown
            size={12}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-[calc(100%+8px)] z-50 min-w-[200px] overflow-hidden rounded-lg border border-line bg-panel py-1.5 shadow-xl"
          >
            <Link
              href={homeHref}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-sec transition-colors hover:bg-hoverbg hover:text-txt"
            >
              <IconHome size={16} />
              {homeLabel}
            </Link>
            <Link
              href="/dashboard/account"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-sec transition-colors hover:bg-hoverbg hover:text-txt"
            >
              <IconAccount size={16} />
              Account
            </Link>
            <form action={signOutAction}>
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] text-sec transition-colors hover:bg-hoverbg hover:text-down"
              >
                <IconSignOut size={16} />
                Logout
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
