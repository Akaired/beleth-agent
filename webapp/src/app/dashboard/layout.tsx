import { requireSession, roleAtLeast } from "@/lib/auth";
import { fetchOpenSpreadCount } from "@/lib/dashboard-queries";
import { fetchRecentChatSessions } from "@/lib/chat/queries";
import { DashboardChrome } from "@/components/dashboard/chrome";

export default async function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  const ctx = await requireSession();

  // The Positions view (and its sidebar badge) is demo_admin and up.
  const [openSpreads, recentChats] = await Promise.all([
    roleAtLeast(ctx.role, "demo_admin") ? fetchOpenSpreadCount() : Promise.resolve(0),
    fetchRecentChatSessions(3),
  ]);

  return (
    <DashboardChrome
      role={ctx.role}
      email={ctx.email}
      badges={{ "/dashboard/positions": openSpreads }}
      recentChats={recentChats}
    >
      {children}
    </DashboardChrome>
  );
}
