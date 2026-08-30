import { getSessionContext, roleAtLeast } from "@/lib/auth";
import { fetchOpenSpreadCount } from "@/lib/dashboard-queries";
import { fetchRecentChatSessions } from "@/lib/chat/queries";
import { fetchRecentForumTopicsByAuthor } from "@/lib/forum/queries";
import { DashboardChrome } from "@/components/dashboard/chrome";
import { PublicDocsShell } from "@/components/docs/public-docs-shell";

/**
 * Documentation renders for logged-out visitors too. Signed in → the normal
 * dashboard chrome (rail + top bar). Signed out → the public header + footer
 * shell, no sidebar. Same URLs either way; `src/proxy.ts` does not gate
 * `/docs`.
 */
export default async function DocsLayout({ children }: LayoutProps<"/docs">) {
  const ctx = await getSessionContext();
  if (!ctx) return <PublicDocsShell>{children}</PublicDocsShell>;

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
