"use client";

import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { roleAtLeast, type Role } from "@/lib/roles";
import type { ChatSessionSummary } from "@/lib/chat/types";
import type { ForumRecentTopic } from "@/lib/forum/types";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { ChatNav } from "@/components/dashboard/chat-nav";
import { AccountDropdown } from "@/components/account-dropdown";
import {
  IconOverview,
  IconPositions,
  IconDecisions,
  IconStrategy,
  IconControls,
  IconLogs,
  IconMarketCalendar,
  IconPortfolio,
  IconTradeCalendar,
  IconMenu,
  IconClose,
  IconCaretRight,
  IconAccount,
  IconBeleth,
  IconAdmin,
  IconCode,
  IconDocs,
  IconForum,
  IconReports,
  IconSettings,
} from "@/components/icons";

type IconProps = { size?: number; weight?: "regular" | "bold" | "fill"; className?: string };
type Item = {
  href: string;
  label: string;
  min: Role;
  Icon: ComponentType<IconProps>;
  // Placeholder entry: shown but not navigable yet.
  disabled?: boolean;
};
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
      { href: "/dashboard/calendar", label: "Calendar", min: "demo_admin", Icon: IconMarketCalendar },
      { href: "/dashboard/portfolio", label: "Portfolio", min: "demo_admin", Icon: IconPortfolio, disabled: true },
    ],
  },
  {
    label: "User",
    items: [
      { href: "/dashboard/account", label: "Profile", min: "public_user", Icon: IconAccount },
      { href: "/dashboard/beleth", label: "Beleth", min: "public_user", Icon: IconBeleth, disabled: true },
      { href: "/forum", label: "Forum", min: "public_user", Icon: IconForum },
    ],
  },
  {
    label: "Records",
    items: [
      { href: "/dashboard/trade-calendar", label: "Trade calendar", min: "demo_admin", Icon: IconTradeCalendar },
      { href: "/dashboard/decisions", label: "Decision history", min: "demo_admin", Icon: IconDecisions },
      { href: "/dashboard/strategy", label: "Strategy strategy", min: "demo_admin", Icon: IconStrategy },
      { href: "/dashboard/reports", label: "Reports", min: "demo_admin", Icon: IconReports, disabled: true },
    ],
  },
  {
    label: "Operator",
    items: [
      { href: "/dashboard/admin", label: "Admin", min: "master_admin", Icon: IconAdmin },
      { href: "/dashboard/controls", label: "Controls", min: "master_admin", Icon: IconControls },
      { href: "/dashboard/logs", label: "Logs", min: "master_admin", Icon: IconLogs },
      { href: "/dashboard/api", label: "API", min: "master_admin", Icon: IconCode, disabled: true },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/dashboard"
    ? pathname === "/dashboard"
    : pathname.startsWith(href);
}

function ForumRecentRows({
  topics,
  onNavigate,
}: {
  topics: ForumRecentTopic[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  if (topics.length === 0) return null;
  return (
    <>
      {topics.map((t) => {
        const active = pathname === `/forum/t/${t.slug}`;
        return (
          <Link
            key={t.id}
            href={`/forum/t/${t.slug}`}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={t.title}
            className={`flex items-center gap-2 border-l-2 py-[3px] pl-7 pr-3 text-[12px] transition-colors ${
              active
                ? "border-acc bg-hoverbg text-txt"
                : "border-transparent text-sec hover:text-txt"
            }`}
          >
            <IconCaretRight
              size={10}
              weight="bold"
              className={active ? "text-acc" : "text-faint"}
            />
            <span className="truncate">{t.title}</span>
          </Link>
        );
      })}
    </>
  );
}

function NavGroups({
  role,
  badges,
  accountLevel,
  recentChats,
  recentForumTopics,
  onNavigate,
}: {
  role: Role;
  badges?: Record<string, number>;
  /** Current experience level — shown as a "lvl N" chip on the Account item. */
  accountLevel?: number;
  recentChats: ChatSessionSummary[];
  recentForumTopics: ForumRecentTopic[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => roleAtLeast(role, it.min)),
  })).filter((g) => g.items.length > 0);

  return (
    <nav className="flex flex-col py-0.5">
      {groups.map((g) => (
        <div key={g.label}>
        <div className="pt-2 pb-0.5">
          <div className="px-3 pb-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint">
            {g.label}
          </div>
          {g.items.map((it) => {
            if (it.disabled) {
              return (
                <div
                  key={it.href}
                  aria-disabled="true"
                  title="Coming soon"
                  className="flex items-center gap-2.5 border-l-2 border-transparent py-[4px] pl-2.5 pr-3 text-[12.5px] text-faint cursor-default select-none"
                >
                  <it.Icon size={15} weight="regular" className="text-faint" />
                  <span>{it.label}</span>
                  <span className="ml-auto font-mono text-[8.5px] uppercase tracking-[0.12em] text-faint/70">
                    soon
                  </span>
                </div>
              );
            }
            const active =
              isActive(pathname, it.href) ||
              // The Profile item redirects to the public /u/<id> page.
              (it.href === "/dashboard/account" && pathname.startsWith("/u/"));
            const badge = badges?.[it.href] ?? 0;
            return (
              <div key={it.href}>
                <Link
                  href={it.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2.5 border-l-2 py-[5px] pl-2.5 pr-3 text-[12.5px] transition-colors ${
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
                  {it.href === "/dashboard/account" && accountLevel != null && (
                    <span
                      className="ml-auto rounded bg-chipbg px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-sec"
                      title={`Experience level ${accountLevel}`}
                    >
                      lvl {accountLevel}
                    </span>
                  )}
                </Link>
                {it.href === "/forum" && (
                  <ForumRecentRows
                    topics={recentForumTopics}
                    onNavigate={onNavigate}
                  />
                )}
              </div>
            );
          })}
        </div>
        {/* The Chat section sits right after User (present for every role). */}
        {g.label === "User" && (
          <ChatNav recentChats={recentChats} onNavigate={onNavigate} />
        )}
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const docsActive = pathname === "/docs" || pathname.startsWith("/docs/");
  const settingsActive =
    pathname === "/dashboard/settings" ||
    pathname.startsWith("/dashboard/settings/");
  const footerLink =
    "flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] transition-colors";
  return (
    <div className="shrink-0 flex flex-col gap-2 border-t border-line px-3 py-2.5">
      <Link
        href="/docs"
        onClick={onNavigate}
        aria-current={docsActive ? "page" : undefined}
        className={`${footerLink} ${
          docsActive ? "text-acc" : "text-sec hover:text-txt"
        }`}
      >
        <IconDocs size={13} />
        Docs
      </Link>
      <Link
        href="/dashboard/settings"
        onClick={onNavigate}
        aria-current={settingsActive ? "page" : undefined}
        className={`${footerLink} ${
          settingsActive ? "text-acc" : "text-sec hover:text-txt"
        }`}
      >
        <IconSettings size={13} />
        Settings
      </Link>
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
  displayName = null,
  avatarUrl = null,
  accountLevel,
  badges,
  recentChats = [],
  recentForumTopics = [],
  children,
}: {
  role: Role;
  email: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  accountLevel?: number;
  badges?: Record<string, number>;
  recentChats?: ChatSessionSummary[];
  recentForumTopics?: ForumRecentTopic[];
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
        <AccountDropdown
          role={role}
          email={email}
          displayName={displayName}
          avatarUrl={avatarUrl}
          homeHref="/"
          homeLabel="Homepage"
        />
      </header>

      <div className="flex-1 min-h-0 md:grid md:grid-cols-[196px_minmax(0,1fr)] md:overflow-hidden">
        {/* Desktop rail — nav list scrolls, footer stays pinned */}
        <aside className="hidden md:flex md:min-h-0 md:flex-col md:border-r md:border-line">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NavGroups
              role={role}
              badges={badges}
              accountLevel={accountLevel}
              recentChats={recentChats}
              recentForumTopics={recentForumTopics}
            />
          </div>
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
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <NavGroups
                  role={role}
                  badges={badges}
                  accountLevel={accountLevel}
                  recentChats={recentChats}
                  recentForumTopics={recentForumTopics}
                  onNavigate={() => setOpen(false)}
                />
              </div>
              <SidebarFooter onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
