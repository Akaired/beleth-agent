import { getSessionContext, roleAtLeast } from "@/lib/auth";
import { fetchOpenSpreadCount } from "@/lib/dashboard-queries";
import { fetchRecentChatSessions } from "@/lib/chat/queries";
import { fetchRecentForumTopicsByAuthor } from "@/lib/forum/queries";
import { DashboardChrome } from "@/components/dashboard/chrome";
import { PublicForumShell } from "@/components/forum/public-forum-shell";

/**
 * Public profile pages render for logged-out visitors too — a name in the
 * forum links here. Signed in → the normal dashboard chrome; signed out → the
 * public header + footer shell. Same URLs either way; `src/proxy.ts` does not
 * gate `/u`.
 */
export default async function ProfileLayout({
  children,
}: LayoutProps<"/u/[id]">) {
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
      displayName={ctx.displayName}
      avatarUrl={ctx.avatarUrl}
      badges={{ "/dashboard/positions": openSpreads }}
      recentChats={recentChats}
      recentForumTopics={recentForumTopics}
    >
      {children}
    </DashboardChrome>
  );
}
