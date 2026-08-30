import { requireSession, roleAtLeast } from "@/lib/auth";
import { fetchOpenSpreadCount } from "@/lib/dashboard-queries";
import { fetchRecentChatSessions } from "@/lib/chat/queries";
import { fetchRecentForumTopicsByAuthor } from "@/lib/forum/queries";
import { createClient } from "@/lib/supabase/server";
import { levelForXp } from "@/lib/progress";
import { DashboardChrome } from "@/components/dashboard/chrome";

export default async function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  const ctx = await requireSession();

  // Grant the daily-login XP (idempotent per UTC day; safe on every load).
  // The RPC returns the up-to-date user_progress row, so it doubles as the
  // read for the sidebar "lvl N" chip.
  const dailyLogin = createClient()
    .then((s) => s.rpc("beleth_touch_daily_login"))
    .catch(() => null);

  // The Positions view (and its sidebar badge) is demo_admin and up.
  const [openSpreads, recentChats, recentForumTopics, progress] =
    await Promise.all([
      roleAtLeast(ctx.role, "demo_admin")
        ? fetchOpenSpreadCount()
        : Promise.resolve(0),
      fetchRecentChatSessions(3),
      fetchRecentForumTopicsByAuthor(ctx.userId, 3),
      dailyLogin,
    ]);

  const xp = Number(
    (progress as { data?: { xp?: number } } | null)?.data?.xp ?? 0,
  );
  const accountLevel = levelForXp(xp).rank.level;

  return (
    <DashboardChrome
      role={ctx.role}
      email={ctx.email}
      displayName={ctx.displayName}
      avatarUrl={ctx.avatarUrl}
      accountLevel={accountLevel}
      badges={{ "/dashboard/positions": openSpreads }}
      recentChats={recentChats}
      recentForumTopics={recentForumTopics}
    >
      {children}
    </DashboardChrome>
  );
}
