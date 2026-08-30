import { getSessionContext, roleAtLeast } from "@/lib/auth";
import { fetchOpenSpreadCount } from "@/lib/dashboard-queries";
import { fetchRecentChatSessions } from "@/lib/chat/queries";
import { fetchRecentForumTopicsByAuthor } from "@/lib/forum/queries";
import { DashboardChrome } from "@/components/dashboard/chrome";
import { PublicForumShell } from "@/components/forum/public-forum-shell";

/**
 * The forum is the one section that renders for logged-out visitors too. Signed
 * in → the normal dashboard chrome (rail + top bar, "Forum" nav item active).
 * Signed out → the public header + footer shell, no sidebar. Same URLs either
 * way; `src/proxy.ts` does not gate `/forum`, and writes are guarded in the
 * server actions.
 */
export default async function ForumLayout({
  children,
}: LayoutProps<"/forum">) {
  const ctx = await getSessionContext();
  if (!ctx) return <PublicForumShell>{children}</PublicForumShell>;

  const [openSpreads, recentChats, recentForumTopics] = await Promise.all([
    roleAtLeast(ctx.role, "demo_admin")
      ? fetchOpenSpreadCount()
      : Promise.resolve(0),
    fetchRecentChatSessions(3),
    fetchRecentForumTopicsByAuthor(ctx.userId, 3),
  ]);

  return (
    <DashboardChrome
      role={ctx.role}
      email={ctx.email}
      badges={{ "/dashboard/positions": openSpreads }}
      recentChats={recentChats}
      recentForumTopics={recentForumTopics}
    >
      {children}
    </DashboardChrome>
  );
}
